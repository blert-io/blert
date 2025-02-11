import { createClient, RedisClientType } from 'redis';

const redisClient: RedisClientType = createClient({
  url: process.env.BLERT_REDIS_URI,
  pingInterval: 3 * 60 * 1000,
});

export default async function redis(): Promise<RedisClientType> {
  if (!redisClient.isOpen) {
    redisClient.on('connect', () => console.log('Connected to Redis'));
    redisClient.on('error', (err) => console.error('Redis error:', err));
    await redisClient.connect();
  }

  return redisClient;
}
