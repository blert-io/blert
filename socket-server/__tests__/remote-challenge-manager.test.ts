import {
  CHALLENGE_UPDATES_PUBSUB_KEY,
  ChallengeMode,
  ChallengeType,
  ChallengeUpdateAction,
  RecordingType,
  Stage,
} from '@blert/common';
import { Event, StageMap } from '@blert/common/generated/event_pb';
import { ServerMessage } from '@blert/common/generated/server_message_pb';
import { RedisClientType } from 'redis';
import { WebSocket } from 'ws';

import { ClientStatus } from '../challenge-manager';
import Client from '../client';
import type MessageHandler from '../message-handler';
import { RemoteOperation } from '../metrics';
import { RemoteChallengeManager } from '../remote-challenge-manager';
import { PluginVersions } from '../verification';

describe('RemoteChallengeManager', () => {
  let manager: RemoteChallengeManager;
  let fetchMock: jest.SpyInstance;
  let pubsubHandler: ((message: string, channel: string) => void) | null;

  beforeEach(() => {
    jest.useFakeTimers();
    fetchMock = jest.spyOn(global, 'fetch');

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
    test('posts the event over HTTP', async () => {
      fetchMock.mockResolvedValueOnce(makeResponse(200));

      await manager.updateClientStatus(makeClient().client, ClientStatus.IDLE);

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
      fetchMock.mockResolvedValueOnce(
        makeResponse(400, { error: { message: 'unknown client' } }),
      );

      await manager.updateClientStatus(makeClient().client, ClientStatus.IDLE);

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    test('resolves when every attempt fails to reach the server', async () => {
      fetchMock.mockRejectedValue(new Error('connection refused'));

      const status = manager.updateClientStatus(
        makeClient().client,
        ClientStatus.IDLE,
      );
      await jest.advanceTimersByTimeAsync(10_000);
      await status;

      expect(fetchMock).toHaveBeenCalledTimes(8);
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

  describe('processEvents', () => {
    const challengeId = '0b7e4c19-62d8-4f3a-9c5e-a81f2d6b4370';
    const streamKey = `challenge-events:${challengeId}:${Stage.TOB_BLOAT}`;

    let xAdd: jest.Mock;
    let client: Client;

    beforeEach(() => {
      xAdd = jest.fn();
      const redisClient = {
        duplicate: () => ({
          connect: jest.fn().mockResolvedValue(undefined),
          on: jest.fn(),
          subscribe: jest.fn().mockResolvedValue(undefined),
        }),
        get: jest.fn().mockResolvedValue(null),
        exists: jest.fn().mockResolvedValue(1),
        multi: () => {
          const multi = {
            sIsMember: () => multi,
            xAdd: (...args: unknown[]) => {
              xAdd(...args);
              return multi;
            },
            sAdd: () => multi,
            expire: () => multi,
            exec: jest.fn().mockResolvedValue([0]),
          };
          return multi;
        },
      } as unknown as RedisClientType;
      manager = new RemoteChallengeManager(
        'http://challenge-server',
        redisClient,
      );

      const socket = { on: jest.fn(), send: jest.fn() };
      client = new Client(
        socket as unknown as WebSocket,
        {} as MessageHandler,
        { id: 123, keyId: 456, username: '1Ogp', linkedPlayerId: 789 },
        PluginVersions.fromHeaders({
          'blert-version': '0.9.24',
          'blert-revision': 'ffaaaaff',
          'blert-jar-hash': '10101010',
          'blert-runelite-version': '1.13.1',
        })!,
      );
      client.setActiveChallenge(challengeId);
    });

    test('writes the reported recording config version in client metadata', async () => {
      client.setRecordingConfigVersion(Stage.TOB_BLOAT, 4);
      const event = new Event();
      event.setStage(Stage.TOB_BLOAT as StageMap[keyof StageMap]);
      event.setTick(17);

      await manager.processEvents(client, challengeId, [event]);

      expect(xAdd.mock.calls).toEqual([
        [
          streamKey,
          '*',
          {
            type: '2',
            clientId: '456',
            userId: '123',
            pluginVersion: '0.9.24',
            runeLiteVersion: '1.13.1',
            recordingConfigVersion: '4',
          },
        ],
        [
          streamKey,
          '*',
          { type: '0', clientId: '456', events: expect.any(Buffer) },
        ],
      ]);
    });

    test('omits recording config version until the client reports one', async () => {
      const event = new Event();
      event.setStage(Stage.TOB_BLOAT as StageMap[keyof StageMap]);
      event.setTick(23);

      await manager.processEvents(client, challengeId, [event]);

      expect(xAdd.mock.calls).toEqual([
        [
          streamKey,
          '*',
          {
            type: '2',
            clientId: '456',
            userId: '123',
            pluginVersion: '0.9.24',
            runeLiteVersion: '1.13.1',
          },
        ],
        [
          streamKey,
          '*',
          { type: '0', clientId: '456', events: expect.any(Buffer) },
        ],
      ]);
    });

    test('writes new client metadata when a version is reported after events', async () => {
      const first = new Event();
      first.setStage(Stage.TOB_BLOAT as StageMap[keyof StageMap]);
      first.setTick(31);
      const second = new Event();
      second.setStage(Stage.TOB_BLOAT as StageMap[keyof StageMap]);
      second.setTick(32);

      await manager.processEvents(client, challengeId, [first]);
      client.setRecordingConfigVersion(Stage.TOB_BLOAT, 6);
      await manager.processEvents(client, challengeId, [second]);

      expect(xAdd.mock.calls).toEqual([
        [
          streamKey,
          '*',
          {
            type: '2',
            clientId: '456',
            userId: '123',
            pluginVersion: '0.9.24',
            runeLiteVersion: '1.13.1',
          },
        ],
        [
          streamKey,
          '*',
          { type: '0', clientId: '456', events: expect.any(Buffer) },
        ],
        [
          streamKey,
          '*',
          {
            type: '2',
            clientId: '456',
            userId: '123',
            pluginVersion: '0.9.24',
            runeLiteVersion: '1.13.1',
            recordingConfigVersion: '6',
          },
        ],
        [
          streamKey,
          '*',
          { type: '0', clientId: '456', events: expect.any(Buffer) },
        ],
      ]);
    });

    test('only writes metadata once if the version does not change', async () => {
      client.setRecordingConfigVersion(Stage.TOB_BLOAT, 9);
      const first = new Event();
      first.setStage(Stage.TOB_BLOAT as StageMap[keyof StageMap]);
      first.setTick(44);
      const second = new Event();
      second.setStage(Stage.TOB_BLOAT as StageMap[keyof StageMap]);
      second.setTick(45);

      await manager.processEvents(client, challengeId, [first]);
      client.setRecordingConfigVersion(Stage.TOB_BLOAT, 9);
      await manager.processEvents(client, challengeId, [second]);

      expect(xAdd.mock.calls).toEqual([
        [
          streamKey,
          '*',
          {
            type: '2',
            clientId: '456',
            userId: '123',
            pluginVersion: '0.9.24',
            runeLiteVersion: '1.13.1',
            recordingConfigVersion: '9',
          },
        ],
        [
          streamKey,
          '*',
          { type: '0', clientId: '456', events: expect.any(Buffer) },
        ],
        [
          streamKey,
          '*',
          { type: '0', clientId: '456', events: expect.any(Buffer) },
        ],
      ]);
    });
  });
});
