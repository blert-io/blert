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

    setTimeout(() => this.startPubsub(), 100);
  }

  public override async startOrJoin(
    client: Client,
    challengeType: ChallengeType,
    mode: ChallengeMode,
    party: string[],
    stage: Stage,
    recordingType: RecordingType,
  ): Promise<ChallengeStatusResponse> {
    const res = await fetch(`${this.serverUrl}/challenges/new`, {
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

    const status: ChallengeStatusResponse = await res.json();
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
      const res = await fetch(
        `${this.serverUrl}/challenges/${challengeId}/finish`,
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

      if (res.status !== 200) {
        console.log(
          `Challenge completion request failed with status ${res.status}`,
        );
      }
    } catch (e) {
      console.log('Failed to complete challenge:', e);
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

      const res = await fetch(`${this.serverUrl}/challenges/${challengeId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: client.getUserId(),
          update,
        }),
      });

      if (res.status === 200) {
        const response = (await res.json()) as ChallengeStatusResponse;
        return response;
      }
      console.log(`Challenge update request failed with status ${res.status}`);
      return null;
    } catch (e) {
      console.log('Failed to update challenge:', e);
      return null;
    }
  }

  public async getChallengeInfo(
    challengeId: string,
  ): Promise<ChallengeInfo | null> {
    const challenge = await this.redisClient.hGetAll(
      challengesKey(challengeId),
    );
    if (Object.keys(challenge).length === 0) {
      return null;
    }

    try {
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
      console.log('Failed to parse challenge info:', e);
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
      const res = await fetch(
        `${this.serverUrl}/challenges/${challengeId}/join`,
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

      if (res.status !== 200) {
        console.log(`Challenge join request failed with status ${res.status}`);
        return null;
      }

      return (await res.json()) as ChallengeStatusResponse;
    } catch (e) {
      console.log('Failed to join challenge:', e);
      return null;
    }
  }

  public updateClientStatus(client: Client, status: ClientStatus): void {
    const event: ClientStatusEvent = {
      type: ClientEventType.STATUS,
      userId: client.getUserId(),
      status,
    };

    this.redisClient.lPush(CLIENT_EVENTS_KEY, JSON.stringify(event));

    if (status === ClientStatus.DISCONNECTED) {
      this.removeClientFromChallenge(client);
    }
  }

  private async startPubsub(): Promise<void> {
    await this.pubsubClient.connect();
    await this.pubsubClient.subscribe(
      CHALLENGE_UPDATES_PUBSUB_KEY,
      this.handleChallengeUpdate.bind(this),
    );
  }

  private async handleChallengeUpdate(
    message: string,
    channel: string,
  ): Promise<void> {
    if (channel !== CHALLENGE_UPDATES_PUBSUB_KEY) {
      return;
    }

    const update = JSON.parse(message) as ChallengeServerUpdate;

    switch (update.action) {
      case ChallengeUpdateAction.FINISH: {
        const clients = this.clientsByChallenge.get(update.id);
        if (clients) {
          console.log(
            `Challenge ${update.id} finished; notifying ${clients.length} clients`,
          );

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
}
