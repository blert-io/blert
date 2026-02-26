import { createClient, RedisClientType } from 'redis';

import logger from '@/utils/log';
import { recordRedisEvent } from '@/utils/metrics';

let redisClient: RedisClientType | null = null;

function getRedisClient(): RedisClientType {
  redisClient ??= createClient({
    url: process.env.BLERT_REDIS_URI,
    pingInterval: 3 * 60 * 1000,
  });
  return redisClient;
}

export default async function redis(): Promise<RedisClientType> {
  const client = getRedisClient();
  if (!client.isOpen) {
    client.on('connect', () => {
      logger.info('redis_connected');
      recordRedisEvent('connect');
    });
    client.on('error', (err) => {
      logger.error('redis_error', {
        error: err instanceof Error ? err.message : String(err),
      });
      recordRedisEvent('error');
    });
    await client.connect();
  }

  return client;
}
