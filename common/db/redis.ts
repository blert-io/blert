import { Stage, StageStatus } from '../challenge';
import { normalizeRsn } from '../player';

/**
 * Returns the Redis key for a challenge with the given UUID.
 * @param uuid Challenge ID.
 * @returns Key for the challenge's state.
 */
export function challengesKey(uuid: string) {
  return `challenge:${uuid}`;
}

/** The key of the pubsub channel for challenge updates. */
export const CHALLENGE_UPDATES_PUBSUB_KEY = 'challenge-updates';

export enum ChallengeUpdateAction {
  FINISH = 'FINISH',
  STAGE_END = 'STAGE_END',
}

export type ChallengeServerUpdate =
  | { action: ChallengeUpdateAction.FINISH; id: string }
  | {
      action: ChallengeUpdateAction.STAGE_END;
      id: string;
      stage: Stage;
      attempt: number | null;
    };

/** The key of the pubsub channel for name change updates. */
export const NAME_CHANGE_PUBSUB_KEY = 'name-changes';

export enum NameChangeUpdateType {
  /** A player's username was updated without merging records. */
  RENAMED,
  /** Two player records were merged; the newer record was deleted. */
  MERGED,
}

export type NameChangeRenamedUpdate = {
  type: NameChangeUpdateType.RENAMED;
  playerId: number;
  oldName: string;
  newName: string;
};

export type NameChangeMergedUpdate = {
  type: NameChangeUpdateType.MERGED;
  /** The player ID that was deleted (newer record). */
  deletedPlayerId: number;
  /** The player ID that remains (older record). */
  remainingPlayerId: number;
  oldName: string;
  newName: string;
};

export type NameChangeUpdate = NameChangeRenamedUpdate | NameChangeMergedUpdate;

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

export type StageUpdate = {
  stage: Stage;
  status: StageStatus;
  accurate: boolean;
  recordedTicks: number;
  serverTicks: {
    count: number;
    precise: boolean;
  } | null;
  overallTicks:
    { server: { count: number; precise: boolean } } | { local: number } | null;
};

export enum StageStreamType {
  STAGE_EVENTS,
  STAGE_END,
  CLIENT_METADATA,
}

export type ClientStageStream =
  StageStreamMetadata | StageStreamEvents | StageStreamEnd;

export type StageStreamMetadata = {
  type: StageStreamType.CLIENT_METADATA;
  clientId: number;
  userId: number;
  pluginVersion: string;
  runeLiteVersion: string;
  recordingConfigVersion: number | null;
};

export type StageStreamEvents = {
  type: StageStreamType.STAGE_EVENTS;
  clientId: number;
  events: Uint8Array;
};

export type StageStreamEnd = {
  type: StageStreamType.STAGE_END;
  clientId: number;
  update: StageUpdate;
};

/**
 * Returns the Redis key for the stream of events for a challenge stage.
 * @param uuid ID of the challenge.
 * @param stage Stage of the challenge.
 * @param attempt Attempt number of the stage, if any.
 * @returns Key for the challenge stage's event stream.
 */
export function challengeStageStreamKey(
  uuid: string,
  stage: Stage,
  attempt: number | null,
) {
  if (attempt !== null) {
    return `challenge-events:${uuid}:${stage}:${attempt}`;
  }

  return `challenge-events:${uuid}:${stage}`;
}

/**
 * Returns the Redis key for the set of stage stream keys for a challenge.
 * @param uuid ID of the challenge.
 */
export function challengeStreamsSetKey(uuid: string) {
  return `challenge-streams:${uuid}`;
}

/**
 * Returns the Redis key for the processed stages set for a challenge.
 * @param uuid ID of the challenge.
 */
export function challengeProcessedStagesKey(uuid: string) {
  return `challenge:${uuid}:processed-stages`;
}

/**
 * Returns the identifier for a stage attempt stored in the processed stages
 * set.
 * @param stage Stage of the challenge.
 * @param attempt Attempt number of the stage, if any.
 */
export function stageAttemptKey(stage: Stage, attempt: number | null): string {
  return `${String(stage)}${attempt !== null ? `:${attempt}` : ''}`;
}

export function stageStreamToRecord(
  event: ClientStageStream,
): Record<string, string | Buffer> {
  const evt: Record<string, string | Buffer> = {
    type: event.type.toString(),
    clientId: event.clientId.toString(),
  };

  switch (event.type) {
    case StageStreamType.CLIENT_METADATA:
      evt.userId = event.userId.toString();
      evt.pluginVersion = event.pluginVersion;
      evt.runeLiteVersion = event.runeLiteVersion;
      if (event.recordingConfigVersion !== null) {
        evt.recordingConfigVersion = event.recordingConfigVersion.toString();
      }
      break;
    case StageStreamType.STAGE_EVENTS:
      evt.events = Buffer.from(event.events);
      break;
    case StageStreamType.STAGE_END:
      evt.update = JSON.stringify(event.update);
      break;
  }

  return evt;
}

/**
 * Returns the Redis key storing information about the OSRS player with the
 * given username.
 * @param username Username of the player.
 * @returns Key for the player's information.
 */
export function activePlayerKey(username: string) {
  return `player:${normalizeRsn(username)}`;
}
