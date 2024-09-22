import { ChallengeType } from '../challenge';

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
