import { randomUUID } from 'node:crypto';

import redis from '@/actions/redis';
import logger from '@/utils/log';

export type RateLimitConfig = {
  limit: number;
  windowSec: number;
  keyPrefix: string;
  subnetLimit?: number;
};

export type RateLimitEntry = {
  key: string;
  limit: number;
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
 * Rate limit across multiple keys using a sliding window.
 *
 * @param entries Keys to check, each with its own limit.
 * @param windowSec Time window duration in seconds.
 * @returns Combined status which succeeds only if every key is within its
 *   limit. Limit, remaining, and reset report the most constrained key.
 */
export async function rateLimitAll(
  entries: [RateLimitEntry, ...RateLimitEntry[]],
  windowSec: number,
): Promise<RateLimitResult> {
  const now = Date.now();
  const windowStart = now - windowSec * 1000;

  try {
    const client = await redis();
    const pipeline = client.multi();

    for (const { key } of entries) {
      pipeline.zRemRangeByScore(key, 0, windowStart);
      pipeline.zAdd(key, [{ score: now, value: `${now}-${randomUUID()}` }]);
      pipeline.zCard(key);
      pipeline.zRangeWithScores(key, 0, 0);
      pipeline.expire(key, windowSec * 2);
    }

    const results = await pipeline.exec();

    const statuses = entries.map(({ limit }, i) => {
      const countResult = results?.[i * 5 + 2];
      const oldestResult = results?.[i * 5 + 3];
      const count =
        typeof countResult === 'number'
          ? countResult
          : Number.parseInt(String(countResult ?? 0), 10) || 1;
      const oldestScore = getOldestScore(oldestResult);

      const resetBase = Number.isFinite(oldestScore) ? oldestScore : now;

      return {
        success: count <= limit,
        limit,
        remaining: Math.max(0, limit - count),
        reset: toUnixSeconds(resetBase + windowSec * 1000),
      };
    });

    let binding = statuses[0];
    for (const status of statuses.slice(1)) {
      if (
        status.remaining < binding.remaining ||
        (status.remaining === binding.remaining && status.reset > binding.reset)
      ) {
        binding = status;
      }
    }

    return {
      success: statuses.every((status) => status.success),
      limit: binding.limit,
      remaining: binding.remaining,
      reset: binding.reset,
    };
  } catch (error) {
    logger.error('rate_limit_error', {
      keys: entries.map((entry) => entry.key),
      error: error instanceof Error ? error.message : String(error),
    });
    // Fail open and allow the request on Redis errors.
    const limit = Math.min(...entries.map((entry) => entry.limit));
    return {
      success: true,
      limit,
      remaining: limit,
      reset: toUnixSeconds(now + windowSec * 1000),
    };
  }
}

/**
 * Rate limit a single key using a sliding window.
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
  return rateLimitAll([{ key, limit }], windowSec);
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

  try {
    const client = await redis();
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
