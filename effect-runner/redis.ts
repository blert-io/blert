import { RedisClientType, createClient } from 'redis';

import logger from './log';

const PING_INTERVAL_MS = 3 * 60 * 1000;

/**
 * Opens a connection to the Redis server at `uri`.
 * @param uri Redis connection URI.
 * @returns The connected client.
 */
export async function connect(uri: string): Promise<RedisClientType> {
  const client: RedisClientType = createClient({
    url: uri,
    pingInterval: PING_INTERVAL_MS,
  });

  client.on('connect', () => logger.info('redis_connected'));
  client.on('error', (err) =>
    logger.error('redis_error', {
      error: err instanceof Error ? err.message : String(err),
    }),
  );

  await client.connect();
  return client;
}
