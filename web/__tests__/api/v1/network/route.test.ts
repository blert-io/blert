import { ChallengeMode, ChallengeType } from '@blert/common';
import { NextRequest } from 'next/server';
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

function createRequest(params: Record<string, string> = {}): NextRequest {
  const url = new URL('http://localhost:3000/api/v1/network');
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return new NextRequest(url);
}

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
    const response = await GET(createRequest());

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

    const response = await GET(createRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(NETWORK);
    expect(mockedLoadPlayerNetwork).not.toHaveBeenCalled();
    expect(mockClient.set).not.toHaveBeenCalled();
  });

  it('clamps an oversized limit and an unselective threshold', async () => {
    const response = await GET(
      createRequest({ limit: '999999', minConnections: '0' }),
    );

    expect(response.status).toBe(200);
    expect(mockedLoadPlayerNetwork).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10_000, minChallengesTogether: 2 }),
    );
    expect(mockClient.get).toHaveBeenCalledWith(
      expectedKey({ limit: '10000', minConnections: '2' }),
    );
  });

  it('collapses equivalent scale filters onto one cache key', async () => {
    await GET(createRequest({ scale: '5,3,5' }));
    await GET(createRequest({ scale: '3,5' }));

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
      createRequest({
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

  it('collapses sub-day precision onto one cache key', async () => {
    await GET(createRequest({ from: '2026-03-04T00:00:00.001Z' }));
    await GET(createRequest({ from: '2026-03-04T23:59:59.999Z' }));

    const key = expectedKey({
      from: '2026-03-04',
      limit: '10000',
      minConnections: '5',
    });
    expect(mockClient.get).toHaveBeenNthCalledWith(1, key);
    expect(mockClient.get).toHaveBeenNthCalledWith(2, key);
  });

  it('clamps a future bound to the current day', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-03-10T12:34:56.789Z'));

    try {
      await GET(createRequest({ to: '2999-01-01T00:00:00.000Z' }));

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
      createRequest({ from: '2026-03-04', to: '2026-03-01' }),
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
    const response = await GET(createRequest(params));

    expect(response.status).toBe(400);
    expect(mockedLoadPlayerNetwork).not.toHaveBeenCalled();
    expect(mockClient.get).not.toHaveBeenCalled();
  });
});
