'use server';

import { randomUUID } from 'node:crypto';

import redis from '@/actions/redis';
import logger from '@/utils/log';

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

function getOldestScore(entries: unknown): number {
  if (!Array.isArray(entries) || entries.length === 0) {
    return Number.NaN;
  }

  const oldestEntry = entries[0] as unknown;
  if (
    !oldestEntry ||
    typeof oldestEntry !== 'object' ||
    !('score' in oldestEntry)
  ) {
    return Number.NaN;
  }

  const score = Number(oldestEntry.score);
  return Number.isFinite(score) ? score : Number.NaN;
}

/**
 * Rate limit using Redis sorted sets (sliding window algorithm).
 *
 * @param key Unique identifier for the rate limit bucket.
 * @param limit Maximum requests allowed in the configured window.
 * @param windowSec Time window duration in seconds.
 * @returns Rate limit status for the current attempt. Reset reflects when the
 *   oldest retained request exits the window.
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
    pipeline.zRangeWithScores(key, 0, 0);
    pipeline.expire(key, windowSec * 2);

    const results = await pipeline.exec();
    const countResult = results?.[2];
    const oldestResult = results?.[3];
    const count =
      typeof countResult === 'number'
        ? countResult
        : Number.parseInt(String(countResult ?? 0), 10) || 1;
    const oldestScore = getOldestScore(oldestResult);

    const remaining = Math.max(0, limit - count);
    const resetBase = Number.isFinite(oldestScore) ? oldestScore : now;
    const reset = toUnixSeconds(resetBase + windowSec * 1000);

    return {
      success: count <= limit,
      limit,
      remaining,
      reset,
    };
  } catch (error) {
    logger.error('rate_limit_error', {
      key,
      error: error instanceof Error ? error.message : String(error),
    });
    // Fail open: allow request on Redis errors.
    return {
      success: true,
      limit,
      remaining: limit,
      reset: toUnixSeconds(now + windowSec * 1000),
    };
  }
}

/**
 * Retrieves the current rate limit status without incrementing the counter.
 * @param key Unique identifier for the rate limit bucket.
 * @param limit Maximum requests allowed in the configured window.
 * @param windowSec Time window duration in seconds.
 * @returns The current rate limit status. Reset reflects when the oldest
 *   retained request exits the window.
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
    const [count, oldestEntries] = await Promise.all([
      client.zCard(key),
      client.zRangeWithScores(key, 0, 0),
    ]);
    const oldestScore = getOldestScore(oldestEntries);
    const resetBase = Number.isFinite(oldestScore) ? oldestScore : now;

    return {
      limit,
      remaining: Math.max(0, limit - count),
      reset: toUnixSeconds(resetBase + windowSec * 1000),
    };
  } catch (error) {
    logger.error('rate_limit_status_error', {
      key,
      error: error instanceof Error ? error.message : String(error),
    });
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
