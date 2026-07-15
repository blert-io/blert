import {
  CLIENT_EVENTS_KEY,
  ClientEventType,
  ClientStatus,
} from '@blert/common';
import { RedisClientType } from 'redis';

import Client from '../client';
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

  describe('updateClientStatus', () => {
    let manager: RemoteChallengeManager;
    let fetchMock: jest.SpyInstance;
    let lPush: jest.Mock;

    function makeClient(): Client {
      return {
        getUserId: () => 435,
        getClientId: () => 286,
        getSessionToken: () => 'session-token',
        getActiveChallengeId: () => null,
      } as unknown as Client;
    }

    beforeEach(() => {
      jest.useFakeTimers();
      fetchMock = jest.spyOn(global, 'fetch');

      lPush = jest.fn().mockResolvedValue(1);
      const duplicate = {
        connect: jest.fn().mockResolvedValue(undefined),
        on: jest.fn(),
        subscribe: jest.fn().mockResolvedValue(undefined),
      };
      const redisClient = {
        duplicate: () => duplicate,
        lPush,
      } as unknown as RedisClientType;

      manager = new RemoteChallengeManager(
        'http://challenge-server',
        redisClient,
      );
    });

    afterEach(() => {
      delete process.env.BLERT_CLIENT_STATUS_HTTP;
      jest.useRealTimers();
      jest.restoreAllMocks();
    });

    test('posts the event over HTTP when enabled', async () => {
      process.env.BLERT_CLIENT_STATUS_HTTP = '1';
      fetchMock.mockResolvedValueOnce(makeResponse(200));

      await manager.updateClientStatus(makeClient(), ClientStatus.IDLE);

      expect(lPush).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('http://challenge-server/client-status');
      expect(JSON.parse((init as RequestInit).body as string)).toEqual({
        userId: 435,
        clientId: 286,
        sessionToken: 'session-token',
        status: ClientStatus.IDLE,
      });
    });

    test('resolves when the server rejects the status', async () => {
      process.env.BLERT_CLIENT_STATUS_HTTP = '1';
      fetchMock.mockResolvedValueOnce(
        makeResponse(400, { error: { message: 'unknown client' } }),
      );

      await manager.updateClientStatus(makeClient(), ClientStatus.IDLE);

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    test('resolves when every attempt fails to reach the server', async () => {
      process.env.BLERT_CLIENT_STATUS_HTTP = '1';
      fetchMock.mockRejectedValue(new Error('connection refused'));

      const status = manager.updateClientStatus(
        makeClient(),
        ClientStatus.IDLE,
      );
      await jest.advanceTimersByTimeAsync(10_000);
      await status;

      expect(fetchMock).toHaveBeenCalledTimes(8);
    });

    test('pushes the event to the queue by default', async () => {
      await manager.updateClientStatus(makeClient(), ClientStatus.DISCONNECTED);

      expect(fetchMock).not.toHaveBeenCalled();
      expect(lPush).toHaveBeenCalledTimes(1);
      const [key, payload] = lPush.mock.calls[0];
      expect(key).toBe(CLIENT_EVENTS_KEY);
      expect(JSON.parse(payload as string)).toEqual({
        type: ClientEventType.STATUS,
        userId: 435,
        clientId: 286,
        sessionToken: 'session-token',
        status: ClientStatus.DISCONNECTED,
      });
    });
  });
});
