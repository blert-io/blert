import { createHash } from 'crypto';

import { ChallengeMode, ChallengeType, Stage, StageStatus } from '../challenge';

function normalizeUsername(username: string): string {
  return username.toLowerCase().replaceAll(' ', '_');
}

function challengePartyKey(type: ChallengeType, partyMembers: string[]) {
  const party = partyMembers.toSorted().map(normalizeUsername).join('-');
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
 * Returns a hash of a party's members.
 * @param party Members of the party.
 * @returns Hash of the party's members.
 */
export function partyHash(party: string[]) {
  return createHash('sha256')
    .update(party.toSorted().map(normalizeUsername).join('-'))
    .digest('hex');
}

/**
 * Returns the Redis key for a session with the given type and party.
 * @param type Type of challenges in the session.
 * @param partyOrHash Either the members of the party or the hash of the party.
 * @returns Key for the session.
 */
export function sessionKey(
  type: ChallengeType,
  partyOrHash: string[] | string,
) {
  const hash = Array.isArray(partyOrHash)
    ? partyHash(partyOrHash)
    : partyOrHash;
  return `session:${type}:${hash}`;
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

/** The key of the list used for the activity feed. */
export const ACTIVITY_FEED_KEY = 'activity-feed';

export type ActivityFeedItem = {
  type: ActivityFeedItemType;
  data: ActivityFeedData;
};

export type ActivityFeedData = ChallengeEndItem;

export enum ActivityFeedItemType {
  CHALLENGE_END,
}

export type ChallengeEndItem = {
  challengeId: string;
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

export interface StageStreamEvents extends ClientStageStream {
  type: StageStreamType.STAGE_EVENTS;
  events: Uint8Array;
}

export interface StageStreamEnd extends ClientStageStream {
  type: StageStreamType.STAGE_END;
  update: StageUpdate;
}

/**
 * Returns the Redis key for the stream of events for a challenge stage.
 * @param uuid ID of the challenge.
 * @param stage Stage of the challenge.
 * @returns Key for the challenge stage's event stream.
 */
export function challengeStageStreamKey(uuid: string, stage: Stage) {
  return `challenge-events:${uuid}:${stage}`;
}

/**
 * Returns the Redis key for the set of stage stream keys for a challenge.
 * @param uuid ID of the challenge.
 */
export function challengeStreamsSetKey(uuid: string) {
  return `challenge-streams:${uuid}`;
}

export function stageStreamToRecord(
  event: ClientStageStream,
): Record<string, string | Buffer> {
  const evt: Record<string, string | Buffer> = {
    type: event.type.toString(),
    clientId: event.clientId.toString(),
  };

  switch (event.type) {
    case StageStreamType.STAGE_EVENTS:
      evt.events = Buffer.from((event as StageStreamEvents).events);
      break;
    case StageStreamType.STAGE_END:
      evt.update = JSON.stringify((event as StageStreamEnd).update);
      break;
  }

  return evt;
}

export function stageStreamFromRecord(
  event: Record<string, string | Buffer>,
): ClientStageStream {
  const type = Number.parseInt(event.type.toString()) as StageStreamType;
  const clientId = Number.parseInt(event.clientId.toString());

  switch (type) {
    case StageStreamType.STAGE_EVENTS:
      return {
        type,
        clientId,
        events: event.events,
      } as StageStreamEvents;

    case StageStreamType.STAGE_END:
      return {
        type,
        clientId,
        update: JSON.parse(event.update.toString()),
      } as StageStreamEnd;

    default:
      return { type, clientId };
  }
}

/**
 * Returns the Redis key storing information about the OSRS player with the
 * given username.
 * @param username Username of the player.
 * @returns Key for the player's information.
 */
export function activePlayerKey(username: string) {
  return `player:${normalizeUsername(username)}`;
}
