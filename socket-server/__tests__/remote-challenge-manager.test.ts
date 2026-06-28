import { RedisClientType } from 'redis';

import { RemoteOperation } from '../metrics';
import { RemoteChallengeManager } from '../remote-challenge-manager';

describe('RemoteChallengeManager', () => {
  function makeResponse(status: number, body: unknown = {}): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    } as unknown as Response;
  }

  describe('request retries', () => {
    let manager: RemoteChallengeManager;
    let fetchMock: jest.SpyInstance;

    beforeEach(() => {
      jest.useFakeTimers();
      fetchMock = jest.spyOn(global, 'fetch');

      const duplicate = {
        connect: jest.fn().mockResolvedValue(undefined),
        on: jest.fn(),
        subscribe: jest.fn().mockResolvedValue(undefined),
      };
      const redisClient = {
        duplicate: () => duplicate,
      } as unknown as RedisClientType;

      manager = new RemoteChallengeManager(
        'http://challenge-server',
        redisClient,
      );
    });

    afterEach(() => {
      jest.useRealTimers();
      jest.restoreAllMocks();
    });

    function callRequest(): Promise<Response> {
      const init: RequestInit = { method: 'POST' };
      return (
        manager as unknown as {
          request: (
            op: RemoteOperation,
            path: string,
            init: RequestInit,
          ) => Promise<Response>;
        }
      ).request('join', '/challenges/abc/join', init);
    }

    test('retries through transient connection failures and succeeds', async () => {
      fetchMock
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockResolvedValueOnce(makeResponse(200, { uuid: 'abc' }));

      const result = callRequest();
      await jest.advanceTimersByTimeAsync(10_000);

      const response = await result;
      expect(response.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    test('retries on 502/503 then returns a successful response', async () => {
      fetchMock
        .mockResolvedValueOnce(makeResponse(503))
        .mockResolvedValueOnce(makeResponse(502))
        .mockResolvedValueOnce(makeResponse(200, {}));

      const result = callRequest();
      await jest.advanceTimersByTimeAsync(10_000);

      const response = await result;
      expect(response.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    test('gives up after exhausting retries on persistent connection errors', async () => {
      fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

      const result = callRequest();
      const expectation = expect(result).rejects.toThrow('ECONNREFUSED');
      await jest.advanceTimersByTimeAsync(10_000);

      await expectation;
      expect(fetchMock).toHaveBeenCalledTimes(8);
    });

    test('stops retrying a persistent 503 and surfaces the last response', async () => {
      fetchMock.mockResolvedValue(makeResponse(503));

      const result = callRequest();
      await jest.advanceTimersByTimeAsync(10_000);

      const response = await result;
      expect(response.status).toBe(503);
      expect(fetchMock).toHaveBeenCalledTimes(8);
    });
  });
});
