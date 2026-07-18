import {
  CHALLENGE_UPDATES_PUBSUB_KEY,
  ChallengeMode,
  ChallengeType,
  ChallengeUpdateAction,
  CLIENT_EVENTS_KEY,
  ClientEventType,
  ClientStatus,
  RecordingType,
  Stage,
} from '@blert/common';
import { ServerMessage } from '@blert/common/generated/server_message_pb';
import { RedisClientType } from 'redis';

import Client from '../client';
import { RemoteOperation } from '../metrics';
import { RemoteChallengeManager } from '../remote-challenge-manager';

describe('RemoteChallengeManager', () => {
  let manager: RemoteChallengeManager;
  let fetchMock: jest.SpyInstance;
  let lPush: jest.Mock;
  let pubsubHandler: ((message: string, channel: string) => void) | null;

  beforeEach(() => {
    jest.useFakeTimers();
    fetchMock = jest.spyOn(global, 'fetch');

    lPush = jest.fn().mockResolvedValue(1);
    pubsubHandler = null;
    const duplicate = {
      connect: jest.fn().mockResolvedValue(undefined),
      on: jest.fn(),
      subscribe: jest
        .fn()
        .mockImplementation(
          (_channel: string, handler: (m: string, c: string) => void) => {
            pubsubHandler = handler;
            return Promise.resolve();
          },
        ),
    };
    const redisClient = {
      duplicate: () => duplicate,
      get: jest.fn().mockResolvedValue(null),
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

  function makeResponse(status: number, body: unknown = {}): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    } as unknown as Response;
  }

  type MockClient = {
    client: Client;
    sendMessage: jest.Mock;
    activeChallengeId: () => string | null;
  };

  function makeClient(): MockClient {
    let activeChallengeId: string | null = null;
    const sendMessage = jest.fn();
    const client = {
      getUserId: () => 435,
      getClientId: () => 286,
      getSessionToken: () => 'session-token',
      getPluginVersions: () => ({
        getVersion: () => '0.9.14',
        getRuneLiteVersion: () => '1.12.33',
      }),
      getActiveChallengeId: () => activeChallengeId,
      setActiveChallenge: (id: string) => {
        activeChallengeId = id;
      },
      clearActiveChallenge: () => {
        activeChallengeId = null;
      },
      sendMessage,
    } as unknown as Client;
    return {
      client,
      sendMessage,
      activeChallengeId: () => activeChallengeId,
    };
  }

  describe('request retries', () => {
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
    test('posts the event over HTTP when enabled', async () => {
      process.env.BLERT_CLIENT_STATUS_HTTP = '1';
      fetchMock.mockResolvedValueOnce(makeResponse(200));

      await manager.updateClientStatus(makeClient().client, ClientStatus.IDLE);

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

      await manager.updateClientStatus(makeClient().client, ClientStatus.IDLE);

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    test('resolves when every attempt fails to reach the server', async () => {
      process.env.BLERT_CLIENT_STATUS_HTTP = '1';
      fetchMock.mockRejectedValue(new Error('connection refused'));

      const status = manager.updateClientStatus(
        makeClient().client,
        ClientStatus.IDLE,
      );
      await jest.advanceTimersByTimeAsync(10_000);
      await status;

      expect(fetchMock).toHaveBeenCalledTimes(8);
    });

    test('pushes the event to the queue by default', async () => {
      await manager.updateClientStatus(
        makeClient().client,
        ClientStatus.DISCONNECTED,
      );

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

  describe('challenge finish notifications', () => {
    beforeEach(async () => {
      // The manager defers its pubsub subscription, so run pending timers to
      // capture the update handler.
      await jest.advanceTimersByTimeAsync(100);
    });

    async function startChallenge(mock: MockClient, uuid: string) {
      fetchMock.mockResolvedValueOnce(
        makeResponse(200, {
          uuid,
          mode: ChallengeMode.TOB_REGULAR,
          stage: Stage.TOB_MAIDEN,
          stageAttempt: null,
        }),
      );
      const status = await manager.startOrJoin(
        mock.client,
        ChallengeType.TOB,
        ChallengeMode.TOB_REGULAR,
        ['1Ogp'],
        Stage.TOB_MAIDEN,
        RecordingType.PARTICIPANT,
      );
      // Mirrors the message handler, which activates the returned challenge
      // after a successful start.
      mock.client.setActiveChallenge(status.uuid);
    }

    function finishChallenge(uuid: string) {
      pubsubHandler!(
        JSON.stringify({ id: uuid, action: ChallengeUpdateAction.FINISH }),
        CHALLENGE_UPDATES_PUBSUB_KEY,
      );
    }

    test('notifies a recording client when its challenge finishes', async () => {
      const mock = makeClient();
      await startChallenge(mock, 'challenge-a');

      finishChallenge('challenge-a');

      expect(mock.sendMessage).toHaveBeenCalledTimes(1);
      const message = mock.sendMessage.mock.calls[0][0] as ServerMessage;
      expect(message.getType()).toBe(ServerMessage.Type.ERROR);
      expect(message.getActiveChallengeId()).toBe('challenge-a');
      expect(message.getError()!.getType()).toBe(
        ServerMessage.Error.Type.CHALLENGE_RECORDING_ENDED,
      );
      expect(mock.activeChallengeId()).toBeNull();
    });

    test('ignores notifications from an old challenge if the client has moved on', async () => {
      const mock = makeClient();
      await startChallenge(mock, 'challenge-a');
      await startChallenge(mock, 'challenge-b');

      finishChallenge('challenge-a');

      expect(mock.sendMessage).not.toHaveBeenCalled();
      expect(mock.activeChallengeId()).toBe('challenge-b');

      finishChallenge('challenge-b');

      expect(mock.sendMessage).toHaveBeenCalledTimes(1);
      const message = mock.sendMessage.mock.calls[0][0] as ServerMessage;
      expect(message.getActiveChallengeId()).toBe('challenge-b');
      expect(mock.activeChallengeId()).toBeNull();
    });

    test('ignores notifications from a challenge that a client is not in', async () => {
      const mock = makeClient();
      await startChallenge(mock, 'challenge-a');
      mock.client.setActiveChallenge('challenge-b');
      finishChallenge('challenge-a');
      expect(mock.sendMessage).not.toHaveBeenCalled();
      expect(mock.activeChallengeId()).toBe('challenge-b');
    });
  });
});
