import {
  CHALLENGE_UPDATES_PUBSUB_KEY,
  ChallengeMode,
  ChallengeServerUpdate,
  ChallengeType,
  ChallengeUpdateAction,
  CLIENT_EVENTS_KEY,
  ClientEventType,
  ClientStatus,
  ClientStatusEvent,
  RecordingType,
  Stage,
  StageStatus,
  StageStreamEnd,
  StageStreamEvents,
  stageStreamToRecord,
  StageStreamType,
  challengeStageStreamKey,
  challengesKey,
  ChallengeStatus,
  challengeStreamsSetKey,
} from '@blert/common';
import { Event } from '@blert/common/generated/event_pb';
import { ChallengeEvents } from '@blert/common/generated/challenge_storage_pb';
import { ServerMessage } from '@blert/common/generated/server_message_pb';
import { RedisClientType } from 'redis';

import ChallengeManager, {
  ChallengeInfo,
  ChallengeStatusResponse,
  ChallengeUpdate,
  RecordedTimes,
} from './challenge-manager';
import Client from './client';
import logger from './log';
import {
  recordRedisEvent,
  RemoteOperation,
  timeRemoteOperation,
} from './metrics';

type ChallengeServerError = {
  error: {
    message: string;
  };
};

export class RemoteChallengeManager extends ChallengeManager {
  private serverUrl: string;
  private redisClient: RedisClientType;
  private pubsubClient: RedisClientType;

  private clientsByChallenge: Map<string, Client[]>;

  public constructor(serverUrl: string, redisClient: RedisClientType) {
    super();
    this.serverUrl = serverUrl;
    this.redisClient = redisClient;
    this.pubsubClient = redisClient.duplicate();
    this.clientsByChallenge = new Map();

    setTimeout(() => {
      void this.startPubsub();
    }, 100);
  }

  public override async startOrJoin(
    client: Client,
    challengeType: ChallengeType,
    mode: ChallengeMode,
    party: string[],
    stage: Stage,
    recordingType: RecordingType,
  ): Promise<ChallengeStatusResponse> {
    const res = await this.request('start', '/challenges/new', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        userId: client.getUserId(),
        type: challengeType,
        mode,
        party,
        stage,
        recordingType,
      }),
    });

    if (!res.ok) {
      const error = (await res.json()) as ChallengeServerError;
      throw new Error(`Challenge server error: ${error.error.message}`);
    }

    const status = (await res.json()) as ChallengeStatusResponse;
    this.addClientToChallenge(client, status.uuid);
    return status;
  }

  public override async completeChallenge(
    client: Client,
    challengeId: string,
    inGameTimes: RecordedTimes | null,
  ): Promise<void> {
    // The plugin uses -1 to indicate that a time was not reported. Also, it is
    // unlikely that one of of the two times would be captured and not the other
    // so only send the times if both are present to simplify the server logic.
    //
    // TODO(frolv): The behavior of the plugin should be made consistent with
    // the logic below so that its times can be sent directly.
    let times = null;
    if (inGameTimes && inGameTimes.challenge > 0 && inGameTimes.overall > 0) {
      times = inGameTimes;
    }

    try {
      const res = await this.request(
        'complete',
        `/challenges/${challengeId}/finish`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            userId: client.getUserId(),
            times,
          }),
        },
      );

      if (!res.ok) {
        const error = (await res.json()) as ChallengeServerError;
        throw new Error(`Challenge server error: ${error.error.message}`);
      }
    } catch (e) {
      logger.error('remote_complete_challenge_failed', {
        error: e instanceof Error ? e.message : String(e),
        challengeUuid: challengeId,
      });
    }

    // Always reset the client's active challenge after completion; the remote
    // server will eventually clean up the challenge after a failure.
    this.removeClientFromChallenge(client);
  }

  public override async updateChallenge(
    client: Client,
    challengeId: string,
    update: ChallengeUpdate,
  ): Promise<ChallengeStatusResponse | null> {
    try {
      if (update.stage !== undefined) {
        if (
          update.stage.status === StageStatus.COMPLETED ||
          update.stage.status === StageStatus.WIPED
        ) {
          const endEvent: StageStreamEnd = {
            type: StageStreamType.STAGE_END,
            clientId: client.getUserId(),
            update: update.stage,
          };
          await this.redisClient.xAdd(
            challengeStageStreamKey(
              challengeId,
              update.stage.stage,
              client.getStageAttempt(update.stage.stage),
            ),
            '*',
            stageStreamToRecord(endEvent),
          );
        }
      }

      const res = await this.request('update', `/challenges/${challengeId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: client.getUserId(),
          update,
        }),
      });

      if (res.ok) {
        const response = (await res.json()) as ChallengeStatusResponse;
        return response;
      }

      const { error } = (await res.json()) as ChallengeServerError;

      if (res.status === 409) {
        logger.warn('remote_challenge_update_rejected', {
          challengeUuid: challengeId,
          message: error.message,
        });
        return null;
      }

      logger.error('remote_challenge_update_failed', {
        challengeUuid: challengeId,
        statusCode: res.status,
        message: error.message,
      });
      return null;
    } catch (e) {
      logger.error('remote_challenge_update_exception', {
        challengeUuid: challengeId,
        error: e instanceof Error ? e.message : String(e),
      });
      return null;
    }
  }

  public async getChallengeInfo(
    challengeId: string,
  ): Promise<ChallengeInfo | null> {
    try {
      const challenge = await this.redisClient.hGetAll(
        challengesKey(challengeId),
      );
      if (Object.keys(challenge).length === 0) {
        return null;
      }

      return {
        type: Number.parseInt(challenge.type) as ChallengeType,
        mode: Number.parseInt(challenge.mode) as ChallengeMode,
        status: Number.parseInt(challenge.status) as ChallengeStatus,
        stage: Number.parseInt(challenge.stage) as Stage,
        stageAttempt: challenge.stageAttempt
          ? Number.parseInt(challenge.stageAttempt)
          : null,
        party: challenge.party.split(','),
      };
    } catch (e) {
      logger.error('remote_challenge_info_exception', {
        challengeUuid: challengeId,
        error: e instanceof Error ? e.message : String(e),
      });
      return null;
    }
  }

  public async processEvents(
    client: Client,
    challengeId: string,
    events: Event[],
  ): Promise<void> {
    const eventsByStage = new Map<Stage, Event[]>();
    for (const event of events) {
      const stage = event.getStage();
      if (!eventsByStage.has(stage)) {
        eventsByStage.set(stage, []);
      }

      eventsByStage.get(stage)!.push(event);
    }

    const multi = this.redisClient.multi();

    for (const [stage, stageEvents] of eventsByStage) {
      const eventsMessage = new ChallengeEvents();
      eventsMessage.setEventsList(stageEvents);

      const eventsStream: StageStreamEvents = {
        type: StageStreamType.STAGE_EVENTS,
        clientId: client.getUserId(),
        events: eventsMessage.serializeBinary(),
      };
      multi.xAdd(
        challengeStageStreamKey(
          challengeId,
          stage,
          client.getStageAttempt(stage),
        ),
        '*',
        stageStreamToRecord(eventsStream),
      );
      multi.sAdd(
        challengeStreamsSetKey(challengeId),
        challengeStageStreamKey(
          challengeId,
          stage,
          client.getStageAttempt(stage),
        ),
      );
    }

    await multi.exec();
  }

  public async addClient(
    client: Client,
    challengeId: string,
    recordingType: RecordingType,
  ): Promise<ChallengeStatusResponse | null> {
    try {
      const res = await this.request(
        'join',
        `/challenges/${challengeId}/join`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            userId: client.getUserId(),
            recordingType,
          }),
        },
      );

      if (!res.ok) {
        const { error } = (await res.json()) as ChallengeServerError;
        logger.warn('remote_challenge_join_failed', {
          challengeUuid: challengeId,
          message: error.message,
        });
        return null;
      }

      return (await res.json()) as ChallengeStatusResponse;
    } catch (e) {
      logger.error('remote_challenge_join_exception', {
        challengeUuid: challengeId,
        error: e instanceof Error ? e.message : String(e),
      });
      return null;
    }
  }

  public updateClientStatus(client: Client, status: ClientStatus): void {
    const event: ClientStatusEvent = {
      type: ClientEventType.STATUS,
      userId: client.getUserId(),
      status,
    };

    void this.redisClient.lPush(CLIENT_EVENTS_KEY, JSON.stringify(event));

    if (status === ClientStatus.DISCONNECTED) {
      this.removeClientFromChallenge(client);
    }
  }

  private async startPubsub(): Promise<void> {
    await this.pubsubClient.connect();
    this.pubsubClient.on('error', (err) => {
      recordRedisEvent('error');
      logger.error('redis_error', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
    await this.pubsubClient.subscribe(
      CHALLENGE_UPDATES_PUBSUB_KEY,
      this.handleChallengeUpdate.bind(this),
    );
  }

  private handleChallengeUpdate(message: string, channel: string): void {
    if (channel !== CHALLENGE_UPDATES_PUBSUB_KEY) {
      return;
    }

    const update = JSON.parse(message) as ChallengeServerUpdate;

    switch (update.action) {
      case ChallengeUpdateAction.FINISH: {
        const clients = this.clientsByChallenge.get(update.id);
        if (clients) {
          logger.info('remote_challenge_finished_notification', {
            challengeUuid: update.id,
            clientCount: clients.length,
          });

          const endMessage = new ServerMessage();
          endMessage.setType(ServerMessage.Type.ERROR);
          endMessage.setActiveChallengeId(update.id);
          const error = new ServerMessage.Error();
          error.setType(ServerMessage.Error.Type.CHALLENGE_RECORDING_ENDED);
          endMessage.setError(error);

          for (const client of clients) {
            client.sendMessage(endMessage);
            client.clearActiveChallenge();
          }

          this.clientsByChallenge.delete(update.id);
        }
        break;
      }
    }
  }

  private addClientToChallenge(client: Client, challengeId: string): void {
    if (!this.clientsByChallenge.has(challengeId)) {
      this.clientsByChallenge.set(challengeId, []);
    }
    this.clientsByChallenge.get(challengeId)!.push(client);
  }

  private removeClientFromChallenge(client: Client): void {
    const challengeId = client.getActiveChallengeId();
    if (!challengeId) {
      return;
    }

    const clients = this.clientsByChallenge.get(challengeId);
    if (!clients) {
      return;
    }

    if (clients.length === 1) {
      this.clientsByChallenge.delete(challengeId);
    } else {
      this.clientsByChallenge.set(
        challengeId,
        clients.filter((c) => c !== client),
      );
    }

    client.clearActiveChallenge();
  }

  private async request(
    operation: RemoteOperation,
    path: string,
    init: RequestInit,
  ): Promise<Response> {
    const maxRetries = 4;
    const baseDelayMs = 100;

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await timeRemoteOperation(operation, () =>
          fetch(`${this.serverUrl}${path}`, init),
        );

        // Retry on transient reverse proxy errors (502/503).
        if (response.status === 502 || response.status === 503) {
          lastError = new Error(`Server error: ${response.status}`);
          if (attempt < maxRetries - 1) {
            const delayMs = baseDelayMs * Math.pow(2, attempt);
            await this.sleep(delayMs);
            continue;
          }
        }

        return response;
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
        if (attempt < maxRetries - 1) {
          const delayMs = baseDelayMs * Math.pow(2, attempt);
          logger.warn('remote_request_retry', {
            operation,
            path,
            attempt: attempt + 1,
            delayMs,
            error: lastError,
          });
          await this.sleep(delayMs);
        }
      }
    }

    throw lastError ?? new Error('Request failed after retries');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
