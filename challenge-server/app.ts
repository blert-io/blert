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
    throw new Error(`${envVar} is not set`);
  }

  const repositoryUri = process.env[envVar]!;

  if (repositoryUri.startsWith('file://')) {
    const root = repositoryUri.slice('file://'.length);
    logger.info(`DataRepository using filesystem backend at ${root}`);
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
    logger.info(`DataRepository using S3 backend bucket ${bucket}`);
    repositoryBackend = new DataRepository.S3Backend(s3Client, bucket);
  } else {
    throw new Error(`Unknown repository backend type: ${repositoryUri}`);
  }

  return new DataRepository(repositoryBackend);
}

async function main() {
  dotenv.config({ path: ['.env.local', `.env.${process.env.NODE_ENV}`] });

  if (!process.env.BLERT_REDIS_URI) {
    throw new Error('BLERT_REDIS_URI is not set');
  }

  const redisClient: RedisClientType = createClient({
    url: process.env.BLERT_REDIS_URI,
  });
  await redisClient.connect();

  const challengeDataRepository = initializeDataRepository(
    'BLERT_DATA_REPOSITORY',
  );
  const testDataRepository = initializeDataRepository(
    'BLERT_CLIENT_DATA_REPOSITORY',
  );

  const challengeManager = new ChallengeManager(
    challengeDataRepository,
    redisClient,
    true,
  );

  const app = express();
  const port = process.env.PORT || 3003;

  app.use(express.json());

  if (process.env.NODE_ENV === 'development') {
    app.use((req, res, next) => {
      const time = process.hrtime();
      res.on('finish', () => {
        const diff = process.hrtime(time);
        const duration = diff[0] * 1e3 + diff[1] * 1e-6;
        logger.info(`${req.method} ${req.url} ${duration.toFixed(2)}ms`);
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
    logger.info(`Challenge server started on port ${port}`);
  });
}

main();
