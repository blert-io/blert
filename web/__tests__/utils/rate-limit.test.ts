import { RedisClientType } from 'redis';

import redis from '@/actions/redis';
import {
  getRateLimitKey,
  getRateLimitStatus,
  RateLimitConfig,
  rateLimit,
} from '@/utils/rate-limit';

jest.mock('@/actions/redis');

type MockPipeline = {
  zRemRangeByScore: jest.Mock;
  zAdd: jest.Mock;
  zCard: jest.Mock;
  zRangeWithScores: jest.Mock;
  expire: jest.Mock;
  exec: jest.Mock;
};

type MockRedisClient = {
  multi: jest.Mock;
  zRemRangeByScore: jest.Mock;
  zCard: jest.Mock;
  zRangeWithScores: jest.Mock;
};

const mockedRedis = redis as jest.MockedFunction<typeof redis>;

function createMockPipeline(): MockPipeline {
  return {
    zRemRangeByScore: jest.fn().mockReturnThis(),
    zAdd: jest.fn().mockReturnThis(),
    zCard: jest.fn().mockReturnThis(),
    zRangeWithScores: jest.fn().mockReturnThis(),
    expire: jest.fn().mockReturnThis(),
    exec: jest.fn(),
  };
}

function createMockClient(): MockRedisClient {
  return {
    multi: jest.fn(),
    zRemRangeByScore: jest.fn(),
    zCard: jest.fn(),
    zRangeWithScores: jest.fn(),
  };
}

describe('rate-limit utils', () => {
  let mockClient: MockRedisClient;

  beforeAll(() => {
    jest.useFakeTimers();
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  beforeEach(() => {
    jest.setSystemTime(new Date('2024-01-01T00:00:00Z'));
    mockClient = createMockClient();
    mockedRedis.mockResolvedValue(mockClient as unknown as RedisClientType);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('rateLimit', () => {
    it('allows requests within the configured limit', async () => {
      const pipeline = createMockPipeline();
      const countAfterInsert = 3;
      pipeline.exec.mockResolvedValue([
        null,
        null,
        countAfterInsert,
        [{ value: 'oldest', score: Date.now() }],
        'OK',
      ]);
      mockClient.multi.mockReturnValue(pipeline);

      const result = await rateLimit('ratelimit:test', 5, 60);
      const expectedReset = Math.floor((Date.now() + 60 * 1000) / 1000);

      expect(result).toMatchObject({
        success: true,
        limit: 5,
        remaining: 2,
      });
      expect(result.reset).toBe(expectedReset);
      expect(pipeline.zRemRangeByScore).toHaveBeenCalledWith(
        'ratelimit:test',
        0,
        Date.now() - 60 * 1000,
      );
      expect(pipeline.zAdd).toHaveBeenCalledWith(
        'ratelimit:test',
        expect.arrayContaining([
          expect.objectContaining({
            score: Date.now(),
          }),
        ]),
      );
      expect(pipeline.zRangeWithScores).toHaveBeenCalledWith(
        'ratelimit:test',
        0,
        0,
      );
      expect(pipeline.expire).toHaveBeenCalledWith('ratelimit:test', 120);
    });

    it('blocks requests that exceed the limit', async () => {
      const pipeline = createMockPipeline();
      pipeline.exec.mockResolvedValue([
        null,
        null,
        7,
        [{ value: 'oldest', score: Date.now() }],
        'OK',
      ]);
      mockClient.multi.mockReturnValue(pipeline);

      const result = await rateLimit('ratelimit:test', 5, 60);

      expect(result.success).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.reset).toBe(Math.floor((Date.now() + 60 * 1000) / 1000));
    });

    it('computes reset from the oldest retained request', async () => {
      const pipeline = createMockPipeline();
      const oldestScore = Date.now() - 30 * 1000;
      pipeline.exec.mockResolvedValue([
        null,
        null,
        2,
        [{ value: 'oldest', score: oldestScore }],
        'OK',
      ]);
      mockClient.multi.mockReturnValue(pipeline);

      const result = await rateLimit('ratelimit:test', 5, 60);

      expect(result.reset).toBe(Math.floor((oldestScore + 60 * 1000) / 1000));
    });

    it('fails open without debiting remaining quota when Redis throws an error', async () => {
      const pipeline = createMockPipeline();
      pipeline.exec.mockRejectedValue(new Error('redis down'));
      mockClient.multi.mockReturnValue(pipeline);

      const result = await rateLimit('ratelimit:test', 5, 60);
      const expectedReset = Math.floor((Date.now() + 60 * 1000) / 1000);

      expect(result.success).toBe(true);
      expect(result.remaining).toBe(5);
      expect(result.reset).toBe(expectedReset);
    });
  });

  describe('getRateLimitStatus', () => {
    it('returns remaining tokens without incrementing usage', async () => {
      mockClient.zRemRangeByScore.mockResolvedValue(undefined);
      mockClient.zCard.mockResolvedValue(12);
      mockClient.zRangeWithScores.mockResolvedValue([]);

      const status = await getRateLimitStatus('ratelimit:test', 20, 60);
      const expectedReset = Math.floor((Date.now() + 60 * 1000) / 1000);

      expect(status).toMatchObject({
        limit: 20,
        remaining: 8,
      });
      expect(status.reset).toBe(expectedReset);
      expect(mockClient.zRemRangeByScore).toHaveBeenCalledWith(
        'ratelimit:test',
        0,
        Date.now() - 60 * 1000,
      );
      expect(mockClient.zCard).toHaveBeenCalledWith('ratelimit:test');
      expect(mockClient.zRangeWithScores).toHaveBeenCalledWith(
        'ratelimit:test',
        0,
        0,
      );
    });

    it('returns a full window when Redis errors', async () => {
      mockClient.zRemRangeByScore.mockRejectedValue(new Error('oops'));

      const status = await getRateLimitStatus('ratelimit:test', 10, 60);

      expect(status).toMatchObject({
        limit: 10,
        remaining: 10,
      });
      expect(status.reset).toBe(Math.floor((Date.now() + 60 * 1000) / 1000));
      expect(mockClient.zCard).not.toHaveBeenCalled();
    });
  });

  describe('getRateLimitKey', () => {
    const config: RateLimitConfig = {
      limit: 1,
      windowSec: 60,
      keyPrefix: 'ratelimit:test',
    };

    it('uses API keys when provided', () => {
      expect(getRateLimitKey(config, '1.1.1.1', 'secret')).toBe(
        'ratelimit:test:key:secret',
      );
    });

    it('falls back to IP-based keys', () => {
      expect(getRateLimitKey(config, '1.1.1.1')).toBe(
        'ratelimit:test:ip:1.1.1.1',
      );
    });
  });
});
