import { ChallengeMode, ChallengeType } from '@blert/common';
import { RedisClientType } from 'redis';

jest.mock('@/actions/challenge', () => ({
  countUniquePlayers: jest.fn(),
}));
jest.mock('@/actions/redis');
jest.mock('@/utils/metrics', () => ({
  observeHttpRequest: jest.fn(),
  recordCacheResult: jest.fn(),
}));

import { countUniquePlayers } from '@/actions/challenge';
import redis from '@/actions/redis';
import { apiRequest } from '@/api/__tests__/request';
import { GET } from '@/api/v1/challenges/stats/players/route';

type MockRedisClient = {
  get: jest.Mock;
  set: jest.Mock;
};

const mockedCountUniquePlayers = countUniquePlayers as jest.MockedFunction<
  typeof countUniquePlayers
>;
const mockedRedis = redis as jest.MockedFunction<typeof redis>;

function createMockClient(): MockRedisClient {
  return {
    get: jest.fn(),
    set: jest.fn(),
  };
}

describe('GET /api/v1/challenges/stats/players', () => {
  let mockClient: MockRedisClient;

  beforeEach(() => {
    mockClient = createMockClient();
    mockClient.get.mockResolvedValue(null);
    mockClient.set.mockResolvedValue('OK');
    mockedRedis.mockResolvedValue(mockClient as unknown as RedisClientType);
    mockedCountUniquePlayers.mockResolvedValue(42);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('caches requests with normalized type, mode, and scale filters', async () => {
    const request = apiRequest('/api/v1/challenges/stats/players', {
      scale: '5,3,5',
      type: `${ChallengeType.COLOSSEUM},${ChallengeType.TOB}`,
      mode: `${ChallengeMode.TOB_HARD},${ChallengeMode.TOB_REGULAR}`,
    });

    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ count: 42 });

    const expectedParams = new URLSearchParams({
      mode: [ChallengeMode.TOB_REGULAR, ChallengeMode.TOB_HARD]
        .sort((lhs, rhs) => lhs - rhs)
        .join(','),
      scale: '3,5',
      type: [ChallengeType.TOB, ChallengeType.COLOSSEUM]
        .sort((lhs, rhs) => lhs - rhs)
        .join(','),
    });
    expectedParams.sort();
    const expectedKey = `web:cache:challenges:stats:players:${expectedParams.toString()}`;

    expect(mockClient.get).toHaveBeenCalledWith(expectedKey);
    expect(mockClient.set).toHaveBeenCalledWith(
      expectedKey,
      JSON.stringify({ count: 42 }),
      { EX: 3600 },
    );
  });

  it('caches supported comparator filters with canonical keys', async () => {
    const request = apiRequest('/api/v1/challenges/stats/players', {
      type: String(ChallengeType.TOB),
      scale: 'ge4',
    });

    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ count: 42 });

    const expectedParams = new URLSearchParams({
      scale: '>=4',
      type: `==${ChallengeType.TOB}`,
    });
    expectedParams.sort();
    const expectedKey = `web:cache:challenges:stats:players:${expectedParams.toString()}`;

    expect(mockClient.get).toHaveBeenCalledWith(expectedKey);
    expect(mockClient.set).toHaveBeenCalledWith(
      expectedKey,
      JSON.stringify({ count: 42 }),
      { EX: 3600 },
    );
  });

  it('bypasses Redis when unsupported filters are present', async () => {
    const request = apiRequest('/api/v1/challenges/stats/players', {
      type: String(ChallengeType.TOB),
      status: '1',
    });

    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ count: 42 });
    expect(mockedRedis).not.toHaveBeenCalled();
  });

  it('bypasses Redis for unsupported namespaced filters', async () => {
    const request = apiRequest('/api/v1/challenges/stats/players', {
      type: String(ChallengeType.TOB),
      'split:28': 'le600',
    });

    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ count: 42 });
    expect(mockedRedis).not.toHaveBeenCalled();
  });
});
