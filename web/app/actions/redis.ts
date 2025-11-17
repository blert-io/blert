import { createClient, RedisClientType } from 'redis';

let redisClient: RedisClientType | null = null;

function getRedisClient(): RedisClientType {
  if (redisClient === null) {
    redisClient = createClient({
      url: process.env.BLERT_REDIS_URI,
      pingInterval: 3 * 60 * 1000,
    });
  }
  return redisClient;
}

export default async function redis(): Promise<RedisClientType> {
  const client = getRedisClient();
  if (!client.isOpen) {
    client.on('connect', () => console.log('Connected to Redis'));
    client.on('error', (err) => console.error('Redis error:', err));
    await client.connect();
  }

  return client;
}
