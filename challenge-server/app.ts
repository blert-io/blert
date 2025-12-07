import { S3Client } from '@aws-sdk/client-s3';
import { DataRepository } from '@blert/common';
import dotenv from 'dotenv';
import express from 'express';
import { RedisClientType, createClient } from 'redis';

import { registerApiRoutes } from './api';
import ChallengeManager from './challenge-manager';
import logger from './log';

/**
 * Initializes the repository for Blert's static challenge data files, with a
 * backend set based on the BLERT_DATA_REPOSITORY environment variable.
 * @returns The initialized data repository.
 */
function initializeDataRepository(envVar: string): DataRepository {
  let repositoryBackend: DataRepository.Backend;
  if (!process.env[envVar]) {
    logger.error('environment_missing', { variable: envVar });
    process.exit(1);
  }

  const repositoryUri = process.env[envVar];

  if (repositoryUri.startsWith('file://')) {
    const root = repositoryUri.slice('file://'.length);
    logger.info('data_repository_backend', { backend: 'filesystem', root });
    repositoryBackend = new DataRepository.FilesystemBackend(root);
  } else if (repositoryUri.startsWith('s3://')) {
    const s3Client = new S3Client({
      forcePathStyle: false,
      region: process.env.BLERT_REGION,
      endpoint: process.env.BLERT_ENDPOINT,
      credentials: {
        accessKeyId: process.env.BLERT_ACCESS_KEY_ID!,
        secretAccessKey: process.env.BLERT_SECRET_ACCESS_KEY!,
      },
    });
    const bucket = repositoryUri.slice('s3://'.length);
    logger.info('data_repository_backend', { backend: 's3', bucket });
    repositoryBackend = new DataRepository.S3Backend(s3Client, bucket);
  } else {
    logger.error('data_repository_backend_invalid', { backend: repositoryUri });
    process.exit(1);
  }

  return new DataRepository(repositoryBackend);
}

async function main() {
  dotenv.config({ path: ['.env.local', `.env.${process.env.NODE_ENV}`] });

  if (!process.env.BLERT_REDIS_URI) {
    logger.error('environment_missing', { variable: 'BLERT_REDIS_URI' });
    process.exit(1);
  }

  const redisClient: RedisClientType = createClient({
    url: process.env.BLERT_REDIS_URI,
    pingInterval: 3 * 60 * 1000,
  });
  redisClient.on('connect', () => logger.info('redis_connected'));
  redisClient.on('error', (err) =>
    logger.error('redis_error', {
      error: err instanceof Error ? err : new Error(String(err)),
      message: err instanceof Error ? err.message : String(err),
    }),
  );
  await redisClient.connect();

  const challengeDataRepository = initializeDataRepository(
    'BLERT_DATA_REPOSITORY',
  );
  const testDataRepository = initializeDataRepository(
    'BLERT_TEST_DATA_REPOSITORY',
  );

  const challengeManager = new ChallengeManager(
    challengeDataRepository,
    testDataRepository,
    redisClient,
    true,
  );

  const app = express();
  const port = process.env.PORT ?? 3003;

  app.use(express.json());

  if (process.env.NODE_ENV === 'development') {
    app.use((req, res, next) => {
      const time = process.hrtime();
      res.on('finish', () => {
        const diff = process.hrtime(time);
        const duration = diff[0] * 1e3 + diff[1] * 1e-6;
        logger.debug('http_request_completed', {
          method: req.method,
          url: req.url,
          durationMs: duration,
          status: res.statusCode,
        });
      });
      next();
    });
  }

  app.use((_req, res, next) => {
    res.locals.challengeDataRepository = challengeDataRepository;
    res.locals.challengeManager = challengeManager;
    res.locals.testDataRepository = testDataRepository;
    next();
  });

  registerApiRoutes(app);

  app.listen(port, () => {
    logger.info('challenge_server_listening', { port });
  });
}

void main();
