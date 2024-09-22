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
  Stage,
  RecordingType,
} from '@blert/common';
import { Event } from '@blert/common/generated/event_pb';
import { ServerMessage } from '@blert/common/generated/server_message_pb';
import { RedisClientType } from 'redis';

import ChallengeManager, {
  ChallengeInfo,
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
  ): Promise<string> {
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

    const { challengeId }: { challengeId: string } = await res.json();

    this.addClientToChallenge(client, challengeId);

    return challengeId;
  }

  public override async completeChallenge(
    client: Client,
    challengeId: string,
    times: RecordedTimes | null,
  ): Promise<void> {
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

  public updateChallenge(
    client: Client,
    challengeId: string,
    update: ChallengeUpdate,
  ): Promise<void> {
    throw new Error('Method not implemented.');
  }

  public getChallengeInfo(challengeId: string): Promise<ChallengeInfo | null> {
    throw new Error('Method not implemented.');
  }

  public processEvents(
    client: Client,
    challengeId: string,
    events: Event[],
  ): Promise<void> {
    throw new Error('Method not implemented.');
  }

  public addClient(
    client: Client,
    challengeId: string,
    recordingType: RecordingType,
  ): boolean {
    throw new Error('Method not implemented.');
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
            client.setActiveChallenge(null);
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
    client.setActiveChallenge(challengeId);
  }

  private removeClientFromChallenge(client: Client): void {
    const challengeId = client.getActiveChallenge();
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

    client.setActiveChallenge(null);
  }
}
