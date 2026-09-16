import { ChallengeMode, ChallengeType } from '@blert/common';
import { RedisClientType } from 'redis';

jest.mock('@/actions/challenge', () => ({
  loadPlayerNetwork: jest.fn(),
}));
jest.mock('@/actions/redis');
jest.mock('@/utils/metrics', () => ({
  observeHttpRequest: jest.fn(),
  recordCacheResult: jest.fn(),
}));

import { loadPlayerNetwork } from '@/actions/challenge';
import redis from '@/actions/redis';
import { apiRequest } from '@/api/__tests__/request';
import { GET } from '@/api/v1/network/route';

type MockRedisClient = {
  get: jest.Mock;
  set: jest.Mock;
};

const CACHE_TTL_SEC = 4 * 60 * 60;

const NETWORK: Awaited<ReturnType<typeof loadPlayerNetwork>> = {
  nodes: ['1Ogp'],
  edges: [{ source: '1Ogp', target: '715', value: 7 }],
  meta: {
    filters: {
      type: undefined,
      mode: undefined,
      scale: undefined,
      from: undefined,
      to: undefined,
    },
  },
};

const mockedLoadPlayerNetwork = loadPlayerNetwork as jest.MockedFunction<
  typeof loadPlayerNetwork
>;
const mockedRedis = redis as jest.MockedFunction<typeof redis>;

function expectedKey(params: Record<string, string>): string {
  const search = new URLSearchParams(params);
  search.sort();
  return `web:cache:network:${search.toString()}`;
}

describe('GET /api/v1/network', () => {
  let mockClient: MockRedisClient;

  beforeEach(() => {
    mockClient = { get: jest.fn(), set: jest.fn() };
    mockClient.get.mockResolvedValue(null);
    mockClient.set.mockResolvedValue('OK');
    mockedRedis.mockResolvedValue(mockClient as unknown as RedisClientType);
    mockedLoadPlayerNetwork.mockResolvedValue(NETWORK);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('caches an unfiltered request under a key with defaults resolved', async () => {
    const response = await GET(apiRequest('/api/v1/network'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(NETWORK);
    expect(response.headers.get('Cache-Control')).toBe(
      `public, max-age=${CACHE_TTL_SEC}, stale-while-revalidate=86400`,
    );

    const key = expectedKey({ limit: '10000', minConnections: '5' });
    expect(mockClient.get).toHaveBeenCalledWith(key);
    expect(mockClient.set).toHaveBeenCalledWith(key, JSON.stringify(NETWORK), {
      EX: CACHE_TTL_SEC,
    });
  });

  it('serves a cache hit without querying the database', async () => {
    mockClient.get.mockResolvedValue(JSON.stringify(NETWORK));

    const response = await GET(apiRequest('/api/v1/network'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(NETWORK);
    expect(mockedLoadPlayerNetwork).not.toHaveBeenCalled();
    expect(mockClient.set).not.toHaveBeenCalled();
  });

  it.each([
    ['an oversized limit', { limit: '999999' }, 'limit'],
    [
      'a meaningless connection threshold',
      { minConnections: '0' },
      'minConnections',
    ],
  ])('rejects %s', async (_label, params, name) => {
    const response = await GET(apiRequest('/api/v1/network', params));

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain(name);
    expect(mockedLoadPlayerNetwork).not.toHaveBeenCalled();
    expect(mockClient.get).not.toHaveBeenCalled();
  });

  it('collapses equivalent scale filters onto one cache key', async () => {
    await GET(apiRequest('/api/v1/network', { scale: '5,3,5' }));
    await GET(apiRequest('/api/v1/network', { scale: '3,5' }));

    const key = expectedKey({
      limit: '10000',
      minConnections: '5',
      scale: '3,5',
    });
    expect(mockClient.get).toHaveBeenNthCalledWith(1, key);
    expect(mockClient.get).toHaveBeenNthCalledWith(2, key);
  });

  it('keys distinct filters separately', async () => {
    await GET(
      apiRequest('/api/v1/network', {
        type: String(ChallengeType.TOB),
        mode: String(ChallengeMode.TOB_HARD),
      }),
    );

    expect(mockClient.get).toHaveBeenCalledWith(
      expectedKey({
        limit: '10000',
        minConnections: '5',
        mode: String(ChallengeMode.TOB_HARD),
        type: String(ChallengeType.TOB),
      }),
    );
  });

  it('collapses sub-day precision into one cache key', async () => {
    await GET(
      apiRequest('/api/v1/network', { from: '2026-03-04T00:00:00.001Z' }),
    );
    await GET(
      apiRequest('/api/v1/network', { from: '2026-03-04T23:59:59.999Z' }),
    );

    const key = expectedKey({
      from: '2026-03-04',
      limit: '10000',
      minConnections: '5',
    });
    expect(mockClient.get).toHaveBeenNthCalledWith(1, key);
    expect(mockClient.get).toHaveBeenNthCalledWith(2, key);
  });

  it('replaces a future time with the current date', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-03-10T12:34:56.789Z'));

    try {
      await GET(
        apiRequest('/api/v1/network', { to: '2999-01-01T00:00:00.000Z' }),
      );

      expect(mockClient.get).toHaveBeenCalledWith(
        expectedKey({
          limit: '10000',
          minConnections: '5',
          to: '2026-03-10',
        }),
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('rejects an inverted date range', async () => {
    const response = await GET(
      apiRequest('/api/v1/network', { from: '2026-03-04', to: '2026-03-01' }),
    );

    expect(response.status).toBe(400);
    expect(mockedLoadPlayerNetwork).not.toHaveBeenCalled();
  });

  it.each([
    ['an unknown challenge type', { type: '999' }],
    ['an unknown challenge mode', { mode: '999' }],
    ['an out-of-range team size', { scale: '9' }],
    ['an unparseable date', { from: 'garbage' }],
    ['a non-numeric limit', { limit: 'abc' }],
  ])('rejects %s without querying the database', async (_label, params) => {
    const response = await GET(apiRequest('/api/v1/network', params));

    expect(response.status).toBe(400);
    expect(mockedLoadPlayerNetwork).not.toHaveBeenCalled();
    expect(mockClient.get).not.toHaveBeenCalled();
  });
});
