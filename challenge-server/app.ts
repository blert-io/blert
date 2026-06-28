import { S3Client } from '@aws-sdk/client-s3';
import { DataRepository } from '@blert/common';
import dotenv from 'dotenv';
import express from 'express';
import { RedisClientType, createClient } from 'redis';

import { registerApiRoutes } from './api';
import ChallengeManager from './challenge-manager';
import sql from './db';
import {
  mergeServiceWithWorkerPool,
  PostgresMergeResultStore,
} from './merge-service';
import { MetricsCollector } from './metrics';
import logger from './log';

/** Maximum time to wait for a graceful shutdown before forcibly exiting. */
const SHUTDOWN_TIMEOUT_MS = 10_000;

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

  let mergeWorkers: number | undefined = undefined;
  if (process.env.BLERT_MERGE_WORKERS !== undefined) {
    mergeWorkers = Number(process.env.BLERT_MERGE_WORKERS);
    if (!Number.isInteger(mergeWorkers) || mergeWorkers < 1) {
      logger.error('environment_invalid', {
        variable: 'BLERT_MERGE_WORKERS',
        value: process.env.BLERT_MERGE_WORKERS,
      });
      process.exit(1);
    }
  }

  const mergeService = mergeServiceWithWorkerPool(
    {
      size: mergeWorkers,
      maxOldGenerationSizeMb: 256,
    },
    {
      samplingRepository: testDataRepository,
      resultStore: new PostgresMergeResultStore(sql),
    },
  );

  const challengeManager = new ChallengeManager(
    challengeDataRepository,
    mergeService,
    redisClient,
    true,
  );

  const metricsCollector = new MetricsCollector();

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
    res.locals.mergeService = mergeService;
    res.locals.testDataRepository = testDataRepository;
    next();
  });

  registerApiRoutes(app, metricsCollector);

  const server = app.listen(port, () => {
    logger.info('challenge_server_listening', { port });
  });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info('shutdown_started', { signal });

    const failsafe = setTimeout(() => {
      logger.error('shutdown_timed_out');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    failsafe.unref();

    try {
      // Stop accepting new requests.
      const closed = new Promise<void>((resolve, reject) => {
        server.close((err) => (err !== undefined ? reject(err) : resolve()));
      });
      server.closeIdleConnections();
      await closed;

      await challengeManager.shutdown();

      // Release shared connections now that nothing else will use them.
      await Promise.allSettled([redisClient.quit(), sql.end()]);

      logger.info('shutdown_complete');
      process.exit(0);
    } catch (e) {
      logger.error('shutdown_error', {
        error: e instanceof Error ? e.message : String(e),
        stack: e instanceof Error ? e.stack : undefined,
      });
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

void main();
