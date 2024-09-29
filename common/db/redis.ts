import { ChallengeType, Stage, StageStatus } from '../challenge';

function challengePartyKey(type: ChallengeType, partyMembers: string[]) {
  const party = partyMembers
    .toSorted()
    .map((name) => name.toLowerCase().replaceAll(' ', '_'))
    .join('-');
  return `${type}-${party}`;
}

/**
 * Returns the Redis key for a challenge with the given UUID.
 * @param uuid Challenge ID.
 * @returns Key for the challenge's state.
 */
export function challengesKey(uuid: string) {
  return `challenge:${uuid}`;
}

/**
 * Returns the Redis key for a client's active challenge.
 * @param id ID of the client.
 * @returns Key for the client's active challenge.
 */
export function clientChallengesKey(id: number) {
  return `client-challenges:${id}`;
}

/**
 * Returns the Redis key for the list of active challenges for a specific party.
 * @param type Type of challenge.
 * @param partyMembers Names of players in the party.
 * @returns Key for the list of active challenges.
 */
export function partyKeyChallengeList(
  type: ChallengeType,
  partyMembers: string[],
) {
  return `party:${challengePartyKey(type, partyMembers)}`;
}

/** The key of the pubsub channel for challenge updates. */
export const CHALLENGE_UPDATES_PUBSUB_KEY = 'challenge-updates';

export enum ChallengeUpdateAction {
  FINISH,
}

export type ChallengeServerUpdate = {
  id: string;
  action: ChallengeUpdateAction;
};

/** The key of the list used for client event notifications. */
export const CLIENT_EVENTS_KEY = 'client-events';

export enum ClientEventType {
  STATUS,
}

export enum ClientStatus {
  ACTIVE,
  IDLE,
  DISCONNECTED,
}

export type ClientEvent = {
  type: ClientEventType;
  userId: number;
};

export type ClientStatusEvent = ClientEvent & {
  type: ClientEventType.STATUS;
  status: ClientStatus;
};

export type StageUpdate = {
  stage: Stage;
  status: StageStatus;
  accurate: boolean;
  recordedTicks: number;
  serverTicks: {
    count: number;
    precise: boolean;
  } | null;
};

export enum StageStreamType {
  STAGE_EVENTS,
  STAGE_END,
}

export interface ClientStageStream {
  type: StageStreamType;
  clientId: number;
}

export interface StageStreamEnd extends ClientStageStream {
  type: StageStreamType.STAGE_END;
  update: StageUpdate;
}

export function challengeStageStreamKey(uuid: string, stage: Stage) {
  return `challenge-events:${uuid}:${stage}`;
}

export function stageStreamToRecord(
  event: ClientStageStream,
): Record<string, string> {
  const evt: Record<string, string> = {
    type: event.type.toString(),
    clientId: event.clientId.toString(),
  };

  switch (event.type) {
    case StageStreamType.STAGE_END:
      evt.update = JSON.stringify((event as StageStreamEnd).update);
      break;
  }

  return evt;
}

export function stageStreamFromRecord(
  event: Record<string, string>,
): ClientStageStream {
  const type = Number.parseInt(event.type) as StageStreamType;
  const clientId = Number.parseInt(event.clientId);

  switch (type) {
    case StageStreamType.STAGE_END:
      return {
        type,
        clientId,
        update: JSON.parse(event.update),
      } as StageStreamEnd;
    default:
      return { type, clientId };
  }
}
