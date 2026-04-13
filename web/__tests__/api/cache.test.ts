import { RedisClientType } from 'redis';

import redis from '@/actions/redis';
import { cached, cachedRaw } from '@/api/cache';
import { recordCacheResult } from '@/utils/metrics';

jest.mock('@/actions/redis');
jest.mock('@/utils/metrics');

type MockRedisClient = {
  get: jest.Mock;
  set: jest.Mock;
};

const mockedRedis = redis as jest.MockedFunction<typeof redis>;
const mockedRecordCacheResult = recordCacheResult as jest.MockedFunction<
  typeof recordCacheResult
>;

function createMockClient(): MockRedisClient {
  return {
    get: jest.fn(),
    set: jest.fn(),
  };
}

const OPTIONS = { name: 'test' };

describe('cachedRaw', () => {
  let mockClient: MockRedisClient;

  beforeEach(() => {
    mockClient = createMockClient();
    mockedRedis.mockResolvedValue(mockClient as unknown as RedisClientType);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('returns a JSON string on a cache miss and stores it', async () => {
    mockClient.get.mockResolvedValue(null);
    mockClient.set.mockResolvedValue('OK');

    const fn = jest.fn().mockResolvedValue({ count: 42 });
    const cachedFn = cachedRaw(OPTIONS, (x: string) => x, fn);

    const result = await cachedFn('abc');

    expect(result).toBe(JSON.stringify({ count: 42 }));
    expect(fn).toHaveBeenCalledWith('abc');
    expect(mockClient.get).toHaveBeenCalledWith('web:cache:test:abc');
    expect(mockClient.set).toHaveBeenCalledWith(
      'web:cache:test:abc',
      JSON.stringify({ count: 42 }),
      { EX: 3600 },
    );
    expect(mockedRecordCacheResult).toHaveBeenCalledWith('test', 'miss');
  });

  it('returns the raw cached string on a hit without calling the function', async () => {
    mockClient.get.mockResolvedValue('{"count":99}');

    const fn = jest.fn().mockResolvedValue({ count: 0 });
    const cachedFn = cachedRaw(OPTIONS, (x: string) => x, fn);

    const result = await cachedFn('abc');

    expect(result).toBe('{"count":99}');
    expect(fn).not.toHaveBeenCalled();
    expect(mockClient.set).not.toHaveBeenCalled();
    expect(mockedRecordCacheResult).toHaveBeenCalledWith('test', 'hit');
  });

  it('applies the transform on a cache hit', async () => {
    mockClient.get.mockResolvedValue('{"count":99}');

    const fn = jest.fn().mockResolvedValue({ count: 0 });
    const transform = jest.fn(JSON.parse);
    const cachedFn = cachedRaw(
      { ...OPTIONS, parse: transform },
      (x: string) => x,
      fn,
    );

    const result = await cachedFn('abc');

    expect(result).toEqual({ count: 99 });
    expect(transform).toHaveBeenCalledWith('{"count":99}');
    expect(fn).not.toHaveBeenCalled();
  });

  it('treats a failed transform as an error and rewrites the cache', async () => {
    mockClient.get.mockResolvedValue('not-valid-json');
    mockClient.set.mockResolvedValue('OK');

    const fn = jest.fn().mockResolvedValue({ count: 7 });
    const cachedFn = cachedRaw(
      { ...OPTIONS, parse: JSON.parse },
      (x: string) => x,
      fn,
    );

    const result = await cachedFn('abc');

    expect(result).toEqual({ count: 7 });
    expect(fn).toHaveBeenCalledWith('abc');
    expect(mockClient.set).toHaveBeenCalledWith(
      'web:cache:test:abc',
      JSON.stringify({ count: 7 }),
      { EX: 3600 },
    );
    expect(mockedRecordCacheResult.mock.calls).toEqual([['test', 'error']]);
  });

  it('uses a custom TTL', async () => {
    mockClient.get.mockResolvedValue(null);
    mockClient.set.mockResolvedValue('OK');

    const fn = jest.fn().mockResolvedValue('val');
    const cachedFn = cachedRaw(
      { name: 'test', ttlSec: 120 },
      (x: string) => x,
      fn,
    );

    await cachedFn('abc');

    expect(mockClient.set).toHaveBeenCalledWith(
      'web:cache:test:abc',
      JSON.stringify('val'),
      { EX: 120 },
    );
  });

  it('falls through to the function when Redis get fails', async () => {
    mockClient.get.mockRejectedValue(new Error('redis down'));
    mockClient.set.mockResolvedValue('OK');

    const fn = jest.fn().mockResolvedValue(7);
    const cachedFn = cachedRaw(OPTIONS, (x: string) => x, fn);

    const result = await cachedFn('abc');

    expect(result).toBe(JSON.stringify(7));
    expect(fn).toHaveBeenCalledWith('abc');
    expect(mockedRedis).toHaveBeenCalledTimes(1);
    expect(mockClient.set).not.toHaveBeenCalled();
    expect(mockedRecordCacheResult.mock.calls).toEqual([['test', 'error']]);
  });

  it('still returns the result when Redis set fails', async () => {
    mockClient.get.mockResolvedValue(null);
    mockClient.set.mockRejectedValue(new Error('redis down'));

    const fn = jest.fn().mockResolvedValue(7);
    const cachedFn = cachedRaw(OPTIONS, (x: string) => x, fn);

    const result = await cachedFn('abc');

    expect(result).toBe(JSON.stringify(7));
    expect(mockedRecordCacheResult).toHaveBeenCalledWith('test', 'miss');
  });

  it('passes all arguments to both the key function and the underlying function', async () => {
    mockClient.get.mockResolvedValue(null);
    mockClient.set.mockResolvedValue('OK');

    const fn = jest.fn().mockResolvedValue('ok');
    const keyFn = jest.fn().mockReturnValue('multi-arg-key');
    const cachedFn = cachedRaw(OPTIONS, keyFn, fn);

    await cachedFn('a', 2, true);

    expect(keyFn).toHaveBeenCalledWith('a', 2, true);
    expect(fn).toHaveBeenCalledWith('a', 2, true);
  });
});

describe('cached', () => {
  let mockClient: MockRedisClient;

  beforeEach(() => {
    mockClient = createMockClient();
    mockedRedis.mockResolvedValue(mockClient as unknown as RedisClientType);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('deserializes the cached JSON on a hit', async () => {
    mockClient.get.mockResolvedValue(JSON.stringify({ count: 99 }));

    const fn = jest.fn().mockResolvedValue({ count: 0 });
    const cachedFn = cached(OPTIONS, (x: string) => x, fn);

    const result = await cachedFn('abc');

    expect(result).toEqual({ count: 99 });
    expect(fn).not.toHaveBeenCalled();
  });

  it('falls through on corrupt cached data', async () => {
    mockClient.get.mockResolvedValue('not-valid-json');
    mockClient.set.mockResolvedValue('OK');

    const fn = jest.fn().mockResolvedValue({ count: 7 });
    const cachedFn = cached(OPTIONS, (x: string) => x, fn);

    const result = await cachedFn('abc');

    expect(result).toEqual({ count: 7 });
    expect(fn).toHaveBeenCalledWith('abc');
  });

  it('returns the parsed value on a cache miss', async () => {
    mockClient.get.mockResolvedValue(null);
    mockClient.set.mockResolvedValue('OK');

    const fn = jest.fn().mockResolvedValue(42);
    const cachedFn = cached(OPTIONS, (x: string) => x, fn);

    const result = await cachedFn('abc');

    expect(result).toBe(42);
    expect(fn).toHaveBeenCalledWith('abc');
  });
});
