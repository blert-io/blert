import redis from '@/actions/redis';
import logger from '@/utils/log';
import { recordCacheResult } from '@/utils/metrics';

const KEY_PREFIX = 'web:cache:';
const DEFAULT_TTL_SEC = 3600;

type CachedRawOptions<T> = {
  /**
   * Static name for this cached function. Used as a metric label and as the
   * cache key prefix.
   */
  name: string;
  /** TTL in seconds for cached values. Defaults to 3600. */
  ttlSec?: number;
  /**
   * Transforms the raw cached JSON string before returning. If the transform
   * throws, the cache entry is treated as a miss.
   */
  parse?: (raw: string) => T;
};

type CachedOptions = Omit<CachedRawOptions<unknown>, 'parse'>;

type Cache<Args extends unknown[], R> = {
  /** Returns a value with caching. */
  get: (...args: Args) => Promise<R>;
  /**
   * Deletes the cached value for the given arguments.
   * Errors are captured and logged.
   */
  invalidate: (...args: Args) => Promise<void>;
};

/**
 * Creates a cache over an async function. Reads return raw JSON strings.
 *
 * The `keyFn` callback returns a dynamic suffix that is appended to the
 * static `name` to form the full cache key. Results are stored as JSON
 * strings with a configurable TTL. If a `parse` function is provided it is
 * applied to cache hits; if it throws, the entry is treated as a miss.
 *
 * On cache errors the underlying function is called directly so the request
 * is never blocked by a cache failure.
 */
export function createRawCache<Args extends unknown[], T, R>(
  options: Required<Pick<CachedRawOptions<R>, 'parse'>> &
    Omit<CachedRawOptions<R>, 'parse'>,
  keyFn: (...args: Args) => string,
  fn: (...args: Args) => Promise<T>,
): Cache<Args, R>;

export function createRawCache<Args extends unknown[], T>(
  options: CachedOptions,
  keyFn: (...args: Args) => string,
  fn: (...args: Args) => Promise<T>,
): Cache<Args, string>;

export function createRawCache<Args extends unknown[], T, R>(
  options: CachedRawOptions<R>,
  keyFn: (...args: Args) => string,
  fn: (...args: Args) => Promise<T>,
): Cache<Args, R | string> {
  const { name, ttlSec = DEFAULT_TTL_SEC, parse } = options;
  const keyPrefix = KEY_PREFIX + name + ':';

  const get = async (...args: Args): Promise<R | string> => {
    const key = keyPrefix + keyFn(...args);
    let client: Awaited<ReturnType<typeof redis>> | null = null;
    let cacheResult: 'miss' | 'error' = 'miss';
    let shouldWrite = true;

    try {
      client = await redis();
      const hit = await client.get(key);
      if (hit !== null) {
        try {
          const value = parse !== undefined ? parse(hit) : hit;
          recordCacheResult(name, 'hit');
          return value;
        } catch (error) {
          cacheResult = 'error';
          logger.error('cache_parse_error', {
            key,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } catch (error) {
      cacheResult = 'error';
      shouldWrite = false;
      logger.error('cache_read_error', {
        key,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    recordCacheResult(name, cacheResult);
    const result = await fn(...args);
    const json = JSON.stringify(result);

    if (shouldWrite) {
      try {
        const writeClient = client ?? (await redis());
        await writeClient.set(key, json, { EX: ttlSec });
      } catch (error) {
        logger.error('cache_write_error', {
          key,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return parse !== undefined ? parse(json) : json;
  };

  const invalidate = async (...args: Args): Promise<void> => {
    const key = keyPrefix + keyFn(...args);
    try {
      const client = await redis();
      await client.del(key);
    } catch (error) {
      logger.error('cache_invalidate_error', {
        key,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return { get, invalidate };
}

/**
 * Like {@link createRawCache}, but deserializes the cached JSON on reads.
 */
export function createCache<Args extends unknown[], T>(
  options: CachedOptions,
  keyFn: (...args: Args) => string,
  fn: (...args: Args) => Promise<T>,
): Cache<Args, T> {
  return createRawCache({ ...options, parse: JSON.parse }, keyFn, fn);
}
