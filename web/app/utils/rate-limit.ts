'use server';

import { randomUUID } from 'node:crypto';

import redis from '@/actions/redis';

export type RateLimitConfig = {
  limit: number;
  windowSec: number;
  keyPrefix: string;
};

export type RateLimitResult = {
  success: boolean;
  limit: number;
  remaining: number;
  reset: number;
};

function toUnixSeconds(value: number): number {
  return Math.floor(value / 1000);
}

/**
 * Rate limit using Redis sorted sets (sliding window algorithm).
 *
 * @param key Unique identifier for the rate limit bucket.
 * @param limit Maximum requests allowed in the configured window.
 * @param windowSec Time window duration in seconds.
 * @returns Rate limit status for the current attempt.
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowSec: number,
): Promise<RateLimitResult> {
  const now = Date.now();
  const windowStart = now - windowSec * 1000;
  const client = await redis();

  try {
    const pipeline = client.multi();

    pipeline.zRemRangeByScore(key, 0, windowStart);
    pipeline.zAdd(key, [{ score: now, value: `${now}-${randomUUID()}` }]);
    pipeline.zCard(key);
    pipeline.expire(key, windowSec * 2);

    const results = await pipeline.exec();
    const countResult = results?.[2];
    const count =
      typeof countResult === 'number'
        ? countResult
        : Number.parseInt(String(countResult ?? 0), 10) || 1;

    const remaining = Math.max(0, limit - count);
    const reset = toUnixSeconds(now + windowSec * 1000);

    return {
      success: count <= limit,
      limit,
      remaining,
      reset,
    };
  } catch (error) {
    console.error('Rate limit error:', error);
    // Fail open: allow request on Redis errors.
    return {
      success: true,
      limit,
      remaining: limit - 1,
      reset: toUnixSeconds(now + windowSec * 1000),
    };
  }
}

/**
 * Retrieves the current rate limit status without incrementing the counter.
 * @param key Unique identifier for the rate limit bucket.
 * @param limit Maximum requests allowed in the configured window.
 * @param windowSec Time window duration in seconds.
 * @returns The current rate limit status.
 */
export async function getRateLimitStatus(
  key: string,
  limit: number,
  windowSec: number,
): Promise<Omit<RateLimitResult, 'success'>> {
  const now = Date.now();
  const windowStart = now - windowSec * 1000;
  const client = await redis();

  try {
    await client.zRemRangeByScore(key, 0, windowStart);
    const count = await client.zCard(key);

    return {
      limit,
      remaining: Math.max(0, limit - count),
      reset: toUnixSeconds(now + windowSec * 1000),
    };
  } catch (error) {
    console.error('Rate limit status error:', error);
    return {
      limit,
      remaining: limit,
      reset: toUnixSeconds(now + windowSec * 1000),
    };
  }
}

/**
 * Returns the rate limit key for a request.
 *
 * API key takes precedence over IP-based limits.
 */
export function getRateLimitKey(
  config: RateLimitConfig,
  ip: string,
  apiKey?: string | null,
): string {
  if (apiKey) {
    return `${config.keyPrefix}:key:${apiKey}`;
  }

  return `${config.keyPrefix}:ip:${ip}`;
}
