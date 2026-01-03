import {
  ACTIVITY_FEED_KEY,
  ActivityFeedData,
  ActivityFeedItemType,
  CHALLENGE_UPDATES_PUBSUB_KEY,
  ChallengeMode,
  ChallengeServerUpdate,
  ChallengeStatus,
  ChallengeType,
  CLIENT_EVENTS_KEY,
  ClientEvent,
  ClientStageStream,
  RecordingType,
  SESSION_ACTIVITY_DURATION_MS,
  Stage,
  StageStatus,
  activePlayerKey,
  challengeStageStreamKey,
  challengesKey,
  clientChallengesKey,
  partyKeyChallengeList,
  sessionKey,
  stageStreamFromRecord,
  challengeStreamsSetKey,
} from '@blert/common';
import { commandOptions, RedisClientType, WatchError } from 'redis';

import { ChallengeState } from './event-processing';
import logger from './log';
import { recordWatchConflict } from './metrics';

export const enum TimeoutState {
  NONE = 0,
  STAGE_END = 1,
  CHALLENGE_END = 2,
  CLEANUP = 3,
}

export type ChallengeTimeout = {
  /** Timestamp at which the timeout occurs. */
  timestamp: number;

  /**
   * If clients are still connected at the timeout, the maximum number of times
   * to defer and retry the cleanup operation if the challenge is not removed
   * from the cleanup list.
   * Following the final attempt, the challenge is cleaned up immediately.
   */
  maxRetryAttempts: number;

  /** Interval, in milliseconds, between cleanup attempts. */
  retryIntervalMs: number;
};

export const enum LifecycleState {
  INITIALIZING,
  ACTIVE,
  CLEANUP,
}

export type ExtendedChallengeState = ChallengeState & {
  state: LifecycleState;
  timeoutState: TimeoutState;
  /** Timestamp at which stage processing began. */
  processingStage: number | null;
};

type RedisChallengeState = {
  [K in keyof ExtendedChallengeState]: null extends ExtendedChallengeState[K]
    ? string | undefined
    : string;
};

/** A client connected to an active challenge. */
export type ChallengeClient = {
  userId: number;
  type: RecordingType;
  active: boolean;
  stage: Stage;
  stageAttempt: number | null;
  stageStatus: StageStatus;
  lastCompleted: {
    stage: Stage;
    attempt: number | null;
  };
};

const CHALLENGE_TIMEOUT_KEY = 'expiring-challenges';

function challengeClientsKey(uuid: string): string {
  return `challenge:${uuid}:clients`;
}

function challengeProcessedStagesKey(uuid: string): string {
  return `challenge:${uuid}:processed-stages`;
}

function stageAndAttempt(stage: Stage, attempt: number | null): string {
  return `${String(stage)}${attempt !== null ? `:${attempt}` : ''}`;
}

function challengeToRedis(
  state: Partial<ExtendedChallengeState>,
): Partial<RedisChallengeState> {
  const result: Partial<RedisChallengeState> = {};

  for (const key in state) {
    const k = key as keyof ChallengeState;
    const value = state[k];
    if (value === null) {
      continue;
    }

    if (k === 'players') {
      result[k] = JSON.stringify(value);
    } else if (Array.isArray(value)) {
      // All array values are strings.
      // eslint-disable-next-line @typescript-eslint/no-base-to-string
      result[k] = value.join(',');
    } else if (typeof value === 'object') {
      result[k] = JSON.stringify(value);
    } else if (typeof value === 'boolean') {
      result[k] = value ? '1' : '0';
    } else if (value !== undefined) {
      result[k] = value.toString();
    }
  }

  return result;
}

function challengeFromRedisArray<K extends keyof ExtendedChallengeState>(
  fields: K[],
  values: (string | null)[],
): Partial<Pick<ExtendedChallengeState, K>> {
  const partial: Partial<RedisChallengeState> = {};
  for (let i = 0; i < fields.length; i++) {
    const value = values[i];
    if (value !== null) {
      partial[fields[i]] = value;
    }
  }
  return challengeFromRedis(partial) as Partial<
    Pick<ExtendedChallengeState, K>
  >;
}

/**
 * Converts a complete Redis challenge state to the full ExtendedChallengeState.
 */
function challengeFromRedisComplete(
  state: RedisChallengeState,
): ExtendedChallengeState {
  return {
    id: Number.parseInt(state.id),
    sessionId: Number.parseInt(state.sessionId),
    uuid: state.uuid,
    type: Number.parseInt(state.type) as ChallengeType,
    mode: Number.parseInt(state.mode) as ChallengeMode,
    stage: Number.parseInt(state.stage) as Stage,
    stageAttempt: state.stageAttempt
      ? Number.parseInt(state.stageAttempt)
      : null,
    status: Number.parseInt(state.status) as ChallengeStatus,
    stageStatus: Number.parseInt(state.stageStatus) as StageStatus,
    party: state.party.split(','),
    players: JSON.parse(state.players) as ChallengeState['players'],
    totalDeaths: Number.parseInt(state.totalDeaths),
    challengeTicks: Number.parseInt(state.challengeTicks),
    state: Number.parseInt(state.state) as LifecycleState,
    reportedChallengeTicks: state.reportedChallengeTicks
      ? Number.parseInt(state.reportedChallengeTicks)
      : null,
    reportedOverallTicks: state.reportedOverallTicks
      ? Number.parseInt(state.reportedOverallTicks)
      : null,
    timeoutState: Number.parseInt(state.timeoutState) as TimeoutState,
    processingStage: state.processingStage
      ? Number.parseInt(state.processingStage)
      : null,
    customData: state.customData
      ? (JSON.parse(state.customData) as object)
      : null,
  };
}

/**
 * Converts a partial Redis challenge state to a partial ExtendedChallengeState.
 * Use this when fetching specific fields (e.g., `getChallengeFields`).
 */
function challengeFromRedis(
  state: Partial<RedisChallengeState>,
): Partial<ExtendedChallengeState> {
  const result: Partial<ExtendedChallengeState> = {};

  if (state.id !== undefined) {
    result.id = Number.parseInt(state.id);
  }
  if (state.sessionId !== undefined) {
    result.sessionId = Number.parseInt(state.sessionId);
  }
  if (state.uuid !== undefined) {
    result.uuid = state.uuid;
  }
  if (state.type !== undefined) {
    result.type = Number.parseInt(state.type) as ChallengeType;
  }
  if (state.mode !== undefined) {
    result.mode = Number.parseInt(state.mode) as ChallengeMode;
  }
  if (state.stage !== undefined) {
    result.stage = Number.parseInt(state.stage) as Stage;
  }
  if (state.stageAttempt !== undefined) {
    result.stageAttempt = state.stageAttempt
      ? Number.parseInt(state.stageAttempt)
      : null;
  }
  if (state.status !== undefined) {
    result.status = Number.parseInt(state.status) as ChallengeStatus;
  }
  if (state.stageStatus !== undefined) {
    result.stageStatus = Number.parseInt(state.stageStatus) as StageStatus;
  }
  if (state.party !== undefined) {
    result.party = state.party.split(',');
  }
  if (state.players !== undefined) {
    result.players = JSON.parse(state.players) as ChallengeState['players'];
  }
  if (state.totalDeaths !== undefined) {
    result.totalDeaths = Number.parseInt(state.totalDeaths);
  }
  if (state.challengeTicks !== undefined) {
    result.challengeTicks = Number.parseInt(state.challengeTicks);
  }
  if (state.state !== undefined) {
    result.state = Number.parseInt(state.state) as LifecycleState;
  }
  if (state.reportedChallengeTicks !== undefined) {
    result.reportedChallengeTicks = state.reportedChallengeTicks
      ? Number.parseInt(state.reportedChallengeTicks)
      : null;
  }
  if (state.reportedOverallTicks !== undefined) {
    result.reportedOverallTicks = state.reportedOverallTicks
      ? Number.parseInt(state.reportedOverallTicks)
      : null;
  }
  if (state.timeoutState !== undefined) {
    result.timeoutState = Number.parseInt(state.timeoutState) as TimeoutState;
  }
  if (state.processingStage !== undefined) {
    result.processingStage = state.processingStage
      ? Number.parseInt(state.processingStage)
      : null;
  }
  if (state.customData !== undefined) {
    result.customData = state.customData
      ? (JSON.parse(state.customData) as object)
      : null;
  }

  return result;
}

/**
 * Callback invoked when a Redis key is read, with the key.
 */
type OnReadCallback = (key: string) => Promise<void>;

/**
 * Interface for read operations on challenge data.
 */
interface ChallengeReadOperations {
  /**
   * Fetches the state of a challenge from Redis.
   *
   * @param uuid UUID of the challenge.
   * @returns State of the challenge, or null if the challenge does not exist.
   */
  getChallenge(uuid: string): Promise<ExtendedChallengeState | null>;

  /**
   * Fetches a subset of the state of a challenge from Redis.
   *
   * @param uuid UUID of the challenge.
   * @param fields Fields to fetch.
   * @returns Subset of the state of the challenge.
   */
  getChallengeFields<K extends keyof ExtendedChallengeState>(
    uuid: string,
    fields: K[],
  ): Promise<Partial<Pick<ExtendedChallengeState, K>>>;

  /**
   * Fetches all of the clients connected to a challenge.
   *
   * @param uuid ID of the challenge.
   * @returns List of connected clients.
   */
  getChallengeClients(uuid: string): Promise<ChallengeClient[]>;

  /**
   * Fetches the client belonging to a user connected to a challenge.
   *
   * @param uuid ID of the challenge.
   * @param userId ID of the user.
   * @returns The client, or `null` if either the challenge does not exist or
   *   the user is not connected to it.
   */
  getChallengeClient(
    uuid: string,
    userId: number,
  ): Promise<ChallengeClient | null>;

  /**
   * Fetches the ID of the active challenge for a client, if any.
   *
   * @param userId ID of the user.
   * @returns The active challenge, or `null` if the user is not connected to
   *   any active challenges.
   */
  getActiveChallengeForClient(userId: number): Promise<string | null>;

  /**
   * Fetches the ID of the last challenge started for a party.
   *
   * @param type The type of the challenge.
   * @param party The members of the party.
   * @returns The ID of the last challenge for the party, or `null` if the party
   *   does not have any recent challenges.
   */
  getLastChallengeForParty(
    type: ChallengeType,
    party: string[],
  ): Promise<string | null>;

  /**
   * Fetches the stream of all clients' events for a stage of a challenge.
   *
   * @param challengeId The ID of the challenge.
   * @param stage The stage to get the stream for.
   * @param attempt The attempt number of the stage.
   * @returns The stream of events for the stage.
   */
  getStageStream(
    challengeId: string,
    stage: Stage,
    attempt: number | null,
  ): Promise<ClientStageStream[]>;

  /**
   * Checks if a stage has been processed for a challenge.
   *
   * @param uuid UUID of the challenge.
   * @param stage The stage to check.
   * @param attempt The attempt number of the stage.
   * @returns True if the stage has been processed, false otherwise.
   */
  hasProcessedStage(
    uuid: string,
    stage: Stage,
    attempt: number | null,
  ): Promise<boolean>;

  /**
   * Fetches the timeout configurations of every challenge with a pending timeout.
   *
   * @returns A map of challenge UUIDs to their timeout configurations.
   */
  getChallengeTimeouts(): Promise<Map<string, ChallengeTimeout>>;

  /**
   * Fetches the timeout configuration for a challenge.
   *
   * @param uuid UUID of the challenge.
   * @returns The timeout configuration, or `null` if the challenge does not
   *   have a pending timeout.
   */
  getChallengeTimeout(uuid: string): Promise<ChallengeTimeout | null>;

  /**
   * Fetches the ID of the session for a party.
   *
   * @param type Type of the session.
   * @param party Party member of the session.
   * @returns ID of the session, or `null` if the session does not exist.
   */
  getSessionId(type: ChallengeType, party: string[]): Promise<number | null>;
}

/**
 * Interface for write operations on challenge data.
 */
interface ChallengeWriteOperations {
  /**
   * Updates one or more fields for a challenge.
   *
   * @param uuid The challenge ID.
   * @param fields Fields to set.
   */
  setChallengeFields(
    uuid: string,
    fields: Partial<ExtendedChallengeState>,
  ): void;

  /**
   * Sets metadata for a client belonging to a user in a challenge.
   *
   * @param uuid The challenge ID.
   * @param userId The user's ID.
   * @param client Client metadata.
   */
  setChallengeClient(
    uuid: string,
    userId: number,
    client: ChallengeClient,
  ): void;

  /**
   * Removes a client belonging to a user from a challenge.
   *
   * @param uuid The challenge ID.
   * @param userId The user's ID.
   */
  removeChallengeClient(uuid: string, userId: number): void;

  /**
   * Deletes a stream of stage events for a challenge.
   *
   * @param challengeId The ID of the challenge.
   * @param stage The stage whose events to delete.
   * @param attempt The attempt number of the stage.
   */
  deleteStageStream(
    challengeId: string,
    stage: Stage,
    attempt: number | null,
  ): void;

  /**
   * Marks a stage as processed for a challenge.
   *
   * @param uuid The challenge ID.
   * @param stage The stage to mark as processed.
   * @param attempt The attempt number of the stage.
   */
  setProcessedStage(uuid: string, stage: Stage, attempt: number | null): void;

  /**
   * Starts a timeout for a challenge.
   *
   * @param uuid The challenge ID.
   * @param state The timeout state to apply.
   * @param timeout The timeout configuration.
   */
  setChallengeTimeout(
    uuid: string,
    state: TimeoutState,
    timeout: ChallengeTimeout,
  ): void;

  /**
   * Clears any existing timeout for a challenge.
   *
   * @param uuid The challenge ID.
   */
  clearChallengeTimeout(uuid: string): void;

  /**
   * Starts new challenge in a session.
   *
   * @param sessionId The ID of the session.
   * @param type The type of the challenge.
   * @param party The members of the party.
   */
  setSessionChallenge(
    sessionId: number,
    type: ChallengeType,
    party: string[],
  ): void;

  /**
   * Refreshes the session duration for a party.
   *
   * @param type The type of the challenge.
   * @param party The members of the party.
   */
  refreshSessionDuration(type: ChallengeType, party: string[]): void;

  /**
   * Sets the active challenge for a player.
   *
   * @param displayName OSRS display name of the player.
   * @param uuid The ID of the challenge.
   */
  setPlayerActiveChallenge(displayName: string, uuid: string): void;

  /**
   * Adds a challenge to the party's challenge list.
   *
   * @param type The type of the challenge.
   * @param party The members of the party.
   * @param uuid The ID of the challenge.
   */
  addChallengeForParty(
    type: ChallengeType,
    party: string[],
    uuid: string,
  ): void;

  /**
   * Deletes the ID of the last challenge started for a party.
   *
   * @param type The type of the challenge.
   * @param party The members of the party.
   */
  deleteLastChallengeForParty(type: ChallengeType, party: string[]): void;

  /**
   * Publishes a challenge update to the challenge updates pubsub channel.
   *
   * @param update The update to publish.
   */
  publishChallengeUpdate(update: ChallengeServerUpdate): void;

  /**
   * Adds an item to the activity feed.
   *
   * @param type The type of the activity feed item.
   * @param data The data of the activity feed item.
   */
  addActivityFeedItem(type: ActivityFeedItemType, data: ActivityFeedData): void;
}

/**
 * Provides read operations for challenge data in Redis.
 */
class ChallengeReader implements ChallengeReadOperations {
  constructor(
    private client: RedisClientType,
    private onRead?: OnReadCallback,
  ) {}

  async getChallenge(uuid: string): Promise<ExtendedChallengeState | null> {
    const key = challengesKey(uuid);
    await this.onRead?.(key);
    const state = await this.client.hGetAll(key);
    if (Object.keys(state).length === 0) {
      return null;
    }
    return challengeFromRedisComplete(state as RedisChallengeState);
  }

  async getChallengeFields<K extends keyof ExtendedChallengeState>(
    uuid: string,
    fields: K[],
  ): Promise<Partial<Pick<ExtendedChallengeState, K>>> {
    const key = challengesKey(uuid);
    await this.onRead?.(key);
    const values = await this.client.hmGet(key, fields);
    return challengeFromRedisArray(fields, values);
  }

  async getChallengeClients(uuid: string): Promise<ChallengeClient[]> {
    const key = challengeClientsKey(uuid);
    await this.onRead?.(key);
    const clients = await this.client.hGetAll(key);
    return Object.values(clients).map(
      (client) => JSON.parse(client) as ChallengeClient,
    );
  }

  async getChallengeClient(
    uuid: string,
    userId: number,
  ): Promise<ChallengeClient | null> {
    const key = challengeClientsKey(uuid);
    await this.onRead?.(key);
    const client = await this.client.hGet(key, userId.toString());
    if (!client) {
      return null;
    }
    return JSON.parse(client) as ChallengeClient;
  }

  async getActiveChallengeForClient(userId: number): Promise<string | null> {
    const key = clientChallengesKey(userId);
    await this.onRead?.(key);
    return (await this.client.get(key)) ?? null;
  }

  async getLastChallengeForParty(
    type: ChallengeType,
    party: string[],
  ): Promise<string | null> {
    const key = partyKeyChallengeList(type, party);
    await this.onRead?.(key);
    return (await this.client.lIndex(key, -1)) ?? null;
  }

  async getStageStream(
    challengeId: string,
    stage: Stage,
    attempt: number | null,
  ): Promise<ClientStageStream[]> {
    const key = challengeStageStreamKey(challengeId, stage, attempt);
    await this.onRead?.(key);

    const options = commandOptions({ returnBuffers: true });
    const stageEvents = await this.client.xRange(options, key, '-', '+');

    const stream: ClientStageStream[] = [];
    for (const event of stageEvents) {
      try {
        const streamEvent = stageStreamFromRecord(event.message);
        stream.push(streamEvent);
      } catch (e: unknown) {
        logger.error('stage_stream_event_parse_failed', {
          challengeUuid: challengeId,
          stage,
          attempt,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    return stream;
  }

  async hasProcessedStage(
    uuid: string,
    stage: Stage,
    attempt: number | null,
  ): Promise<boolean> {
    const key = challengeProcessedStagesKey(uuid);
    await this.onRead?.(key);
    return await this.client.sIsMember(key, stageAndAttempt(stage, attempt));
  }

  async getChallengeTimeouts(): Promise<Map<string, ChallengeTimeout>> {
    await this.onRead?.(CHALLENGE_TIMEOUT_KEY);
    const timeouts = await this.client.hGetAll(CHALLENGE_TIMEOUT_KEY);
    return new Map(
      Object.entries(timeouts).map(([uuid, timeout]) => [
        uuid,
        JSON.parse(timeout) as ChallengeTimeout,
      ]),
    );
  }

  async getChallengeTimeout(uuid: string): Promise<ChallengeTimeout | null> {
    await this.onRead?.(CHALLENGE_TIMEOUT_KEY);
    const timeout = await this.client.hGet(CHALLENGE_TIMEOUT_KEY, uuid);
    if (!timeout) {
      return null;
    }
    return JSON.parse(timeout) as ChallengeTimeout;
  }

  async getSessionId(
    type: ChallengeType,
    party: string[],
  ): Promise<number | null> {
    const key = sessionKey(type, party);
    await this.onRead?.(key);
    const raw = await this.client.get(key);
    if (!raw) {
      return null;
    }
    const sessionId = Number.parseInt(raw);
    return Number.isNaN(sessionId) ? null : sessionId;
  }
}

/**
 * Base class for clients that can queue write operations onto a Redis multi.
 */
class ChallengeWriter implements ChallengeWriteOperations {
  private queuedOperations = 0;

  constructor(protected multi: ReturnType<RedisClientType['multi']>) {}

  protected hasQueuedOperations(): boolean {
    return this.queuedOperations > 0;
  }

  /**
   * Cancels the transaction, discarding any operations that were queued.
   * After calling this, no new operations can be queued.
   */
  discard() {
    this.multi.discard();
    this.queuedOperations = 0;
  }

  setChallengeFields(
    uuid: string,
    fields: Partial<ExtendedChallengeState>,
  ): void {
    const key = challengesKey(uuid);
    const toSet = challengeToRedis(fields);
    if (Object.keys(toSet).length > 0) {
      this.multi.hSet(key, toSet);
      this.queuedOperations++;
    }
    for (const [k, v] of Object.entries(fields)) {
      if (v === null) {
        this.multi.hDel(key, k);
        this.queuedOperations++;
      }
    }
  }

  setChallengeClient(
    uuid: string,
    userId: number,
    client: ChallengeClient,
  ): void {
    this.multi.hSet(
      challengeClientsKey(uuid),
      userId.toString(),
      JSON.stringify(client),
    );
    this.multi.set(clientChallengesKey(userId), uuid);
    this.queuedOperations += 2;
  }

  removeChallengeClient(uuid: string, userId: number): void {
    this.multi.hDel(challengeClientsKey(uuid), userId.toString());
    this.multi.del(clientChallengesKey(userId));
    this.queuedOperations += 2;
  }

  deleteStageStream(
    challengeId: string,
    stage: Stage,
    attempt: number | null,
  ): void {
    this.multi.del(challengeStageStreamKey(challengeId, stage, attempt));
    this.queuedOperations++;
  }

  setProcessedStage(uuid: string, stage: Stage, attempt: number | null): void {
    this.multi.sAdd(
      challengeProcessedStagesKey(uuid),
      stageAndAttempt(stage, attempt),
    );
    this.queuedOperations++;
  }

  setChallengeTimeout(
    uuid: string,
    state: TimeoutState,
    timeout: ChallengeTimeout,
  ): void {
    this.multi.hSet(challengesKey(uuid), 'timeoutState', state);
    this.multi.hSet(CHALLENGE_TIMEOUT_KEY, uuid, JSON.stringify(timeout));
    this.queuedOperations += 2;
  }

  clearChallengeTimeout(uuid: string): void {
    this.multi.hSet(challengesKey(uuid), 'timeoutState', TimeoutState.NONE);
    this.multi.hDel(CHALLENGE_TIMEOUT_KEY, uuid);
    this.queuedOperations += 2;
  }

  setSessionChallenge(
    sessionId: number,
    type: ChallengeType,
    party: string[],
  ): void {
    this.multi.set(sessionKey(type, party), sessionId, {
      EX: SESSION_ACTIVITY_DURATION_MS / 1000,
    });
    this.queuedOperations++;
  }

  refreshSessionDuration(type: ChallengeType, party: string[]): void {
    this.multi.expire(
      sessionKey(type, party),
      SESSION_ACTIVITY_DURATION_MS / 1000,
      'GT',
    );
    this.queuedOperations++;
  }

  setPlayerActiveChallenge(displayName: string, uuid: string): void {
    this.multi.set(activePlayerKey(displayName), uuid);
    this.queuedOperations++;
  }

  addChallengeForParty(
    type: ChallengeType,
    party: string[],
    uuid: string,
  ): void {
    this.multi.rPush(partyKeyChallengeList(type, party), uuid);
    this.queuedOperations++;
  }

  deleteLastChallengeForParty(type: ChallengeType, party: string[]): void {
    this.multi.rPop(partyKeyChallengeList(type, party));
    this.queuedOperations++;
  }

  publishChallengeUpdate(update: ChallengeServerUpdate): void {
    this.multi.publish(CHALLENGE_UPDATES_PUBSUB_KEY, JSON.stringify(update));
    this.queuedOperations++;
  }

  addActivityFeedItem(
    type: ActivityFeedItemType,
    data: ActivityFeedData,
  ): void {
    this.multi.xAdd(
      ACTIVITY_FEED_KEY,
      '*',
      {
        type: type.toString(),
        data: JSON.stringify(data),
      },
      {
        TRIM: {
          strategy: 'MAXLEN',
          strategyModifier: '~',
          threshold: 1000,
        },
      },
    );
    this.queuedOperations++;
  }
}

/**
 * Client for batching multiple Redis commands into a single network round trip.
 * Does not support reads or optimistic locking.
 */
export class PipelineClient extends ChallengeWriter {
  constructor(client: RedisClientType) {
    super(client.multi());
  }

  async exec(): Promise<void> {
    if (this.hasQueuedOperations()) {
      await this.multi.exec();
    }
  }
}

/**
 * Client for executing Redis transactions with optimistic locking.
 * Supports both reads (with auto-watching) and writes.
 */
export class TransactionClient
  extends ChallengeWriter
  implements ChallengeReadOperations
{
  private reader: ChallengeReader;
  private watchedKeys = new Set<string>();

  constructor(private client: RedisClientType) {
    super(client.multi());
    this.reader = new ChallengeReader(client, (key) => this.watch(key));
  }

  getChallenge(uuid: string): Promise<ExtendedChallengeState | null> {
    return this.reader.getChallenge(uuid);
  }

  getChallengeFields<K extends keyof ExtendedChallengeState>(
    uuid: string,
    fields: K[],
  ): Promise<Partial<Pick<ExtendedChallengeState, K>>> {
    return this.reader.getChallengeFields(uuid, fields);
  }

  getChallengeClients(uuid: string): Promise<ChallengeClient[]> {
    return this.reader.getChallengeClients(uuid);
  }

  getChallengeClient(
    uuid: string,
    userId: number,
  ): Promise<ChallengeClient | null> {
    return this.reader.getChallengeClient(uuid, userId);
  }

  getActiveChallengeForClient(userId: number): Promise<string | null> {
    return this.reader.getActiveChallengeForClient(userId);
  }

  getLastChallengeForParty(
    type: ChallengeType,
    party: string[],
  ): Promise<string | null> {
    return this.reader.getLastChallengeForParty(type, party);
  }

  getStageStream(
    challengeId: string,
    stage: Stage,
    attempt: number | null,
  ): Promise<ClientStageStream[]> {
    return this.reader.getStageStream(challengeId, stage, attempt);
  }

  hasProcessedStage(
    uuid: string,
    stage: Stage,
    attempt: number | null,
  ): Promise<boolean> {
    return this.reader.hasProcessedStage(uuid, stage, attempt);
  }

  getChallengeTimeouts(): Promise<Map<string, ChallengeTimeout>> {
    return this.reader.getChallengeTimeouts();
  }

  getChallengeTimeout(uuid: string): Promise<ChallengeTimeout | null> {
    return this.reader.getChallengeTimeout(uuid);
  }

  getSessionId(type: ChallengeType, party: string[]): Promise<number | null> {
    return this.reader.getSessionId(type, party);
  }

  private async watch(key: string): Promise<void> {
    if (!this.watchedKeys.has(key)) {
      await this.client.watch(key);
      this.watchedKeys.add(key);
    }
  }

  async exec(): Promise<void> {
    if (this.hasQueuedOperations()) {
      await this.multi.exec();
    }
  }
}

/**
 * Client for consuming events from the client event queue.
 */
export class EventQueueClient {
  private reader: ChallengeReader;

  constructor(private client: RedisClientType) {
    this.reader = new ChallengeReader(client);
  }

  /**
   * Registers an error handler for the Redis connection.
   *
   * @param handler The error handler.
   */
  onError(handler: (err: Error) => void): void {
    this.client.on('error', handler);
  }

  /**
   * Connects to Redis.
   */
  async connect(): Promise<void> {
    await this.client.connect();
  }

  /**
   * Disconnects from Redis.
   */
  async disconnect(): Promise<void> {
    await this.client.disconnect();
  }

  /**
   * Pops an event from the client event queue, blocking until one is available
   * or the timeout is reached.
   *
   * @param timeoutMs Maximum time to wait for an event.
   * @returns The event, or `null` if the timeout was reached.
   */
  async popEvent(timeoutMs: number): Promise<ClientEvent | null> {
    const res = await this.client.blPop(CLIENT_EVENTS_KEY, timeoutMs / 1000);
    if (res === null) {
      return null;
    }
    return JSON.parse(res.element) as ClientEvent;
  }

  /**
   * Returns the current depth of the client event queue.
   */
  async getQueueDepth(): Promise<number> {
    return this.client.lLen(CLIENT_EVENTS_KEY);
  }

  /**
   * Fetches the ID of the active challenge for a client, if any.
   *
   * @param userId ID of the user.
   * @returns The active challenge, or `null` if the user is not connected to
   *   any active challenges.
   */
  getActiveChallengeForClient(userId: number): Promise<string | null> {
    return this.reader.getActiveChallengeForClient(userId);
  }
}

export class RedisClient implements ChallengeReadOperations {
  private reader: ChallengeReader;

  public constructor(private client: RedisClientType) {
    this.reader = new ChallengeReader(client);
  }

  getChallenge(uuid: string): Promise<ExtendedChallengeState | null> {
    return this.reader.getChallenge(uuid);
  }

  getChallengeFields<K extends keyof ExtendedChallengeState>(
    uuid: string,
    fields: K[],
  ): Promise<Partial<Pick<ExtendedChallengeState, K>>> {
    return this.reader.getChallengeFields(uuid, fields);
  }

  getChallengeClients(uuid: string): Promise<ChallengeClient[]> {
    return this.reader.getChallengeClients(uuid);
  }

  getChallengeClient(
    uuid: string,
    userId: number,
  ): Promise<ChallengeClient | null> {
    return this.reader.getChallengeClient(uuid, userId);
  }

  getActiveChallengeForClient(userId: number): Promise<string | null> {
    return this.reader.getActiveChallengeForClient(userId);
  }

  getLastChallengeForParty(
    type: ChallengeType,
    party: string[],
  ): Promise<string | null> {
    return this.reader.getLastChallengeForParty(type, party);
  }

  getStageStream(
    challengeId: string,
    stage: Stage,
    attempt: number | null,
  ): Promise<ClientStageStream[]> {
    return this.reader.getStageStream(challengeId, stage, attempt);
  }

  hasProcessedStage(
    uuid: string,
    stage: Stage,
    attempt: number | null,
  ): Promise<boolean> {
    return this.reader.hasProcessedStage(uuid, stage, attempt);
  }

  getChallengeTimeouts(): Promise<Map<string, ChallengeTimeout>> {
    return this.reader.getChallengeTimeouts();
  }

  getChallengeTimeout(uuid: string): Promise<ChallengeTimeout | null> {
    return this.reader.getChallengeTimeout(uuid);
  }

  getSessionId(type: ChallengeType, party: string[]): Promise<number | null> {
    return this.reader.getSessionId(type, party);
  }

  async deleteChallengeData(
    uuid: string,
    type?: ChallengeType,
    party?: string[],
  ): Promise<void> {
    await this.retryTransaction(
      (client) => {
        const multi = client.multi();
        return {
          client,
          multi,
          exec: async () => {
            await multi.exec();
          },
        };
      },
      async ({ client, multi }) => {
        // Default to fields from the challenge if not explicitly given.
        const fetch: (keyof ExtendedChallengeState)[] = [];
        if (type === undefined) {
          fetch.push('type');
        }
        if (party === undefined) {
          fetch.push('party');
        }
        if (fetch.length > 0) {
          const raw = await client.hmGet(challengesKey(uuid), fetch);
          const fields = challengeFromRedisArray(fetch, raw);
          type ??= fields.type;
          party ??= fields.party;
        }

        multi.del(challengesKey(uuid));
        multi.del(challengeClientsKey(uuid));
        multi.del(challengeProcessedStagesKey(uuid));
        multi.hDel(CHALLENGE_TIMEOUT_KEY, uuid);

        const streamsSetKey = challengeStreamsSetKey(uuid);
        await client.watch(streamsSetKey);
        const streams = await client.sMembers(streamsSetKey);
        for (const stream of streams) {
          multi.del(stream);
        }
        multi.del(streamsSetKey);

        if (type !== undefined && party !== undefined) {
          multi.lRem(partyKeyChallengeList(type, party), 1, uuid);
        }

        if (party !== undefined) {
          const currentChallenges = await Promise.all(
            party.map(async (player) => {
              const key = activePlayerKey(player);
              await client.watch(key);
              return client.get(key);
            }),
          );

          party.forEach((player, i) => {
            if (currentChallenges[i] === uuid) {
              multi.del(activePlayerKey(player));
            }
          });
        }
      },
      'delete_challenge_data',
    );
  }

  /**
   * Executes multiple Redis commands in a single network round trip.
   * Does not support reads or optimistic locking.
   *
   * @param fn The pipeline function. Receives a PipelineClient for writes.
   */
  async pipeline(fn: (p: PipelineClient) => void): Promise<void> {
    const p = new PipelineClient(this.client);
    fn(p);
    await p.exec();
  }

  /**
   * Executes a transaction with optimistic locking. Keys read within the
   * transaction are automatically watched, and the transaction is retried
   * if any watched keys are modified concurrently.
   *
   * @param fn The transaction function. Receives a TransactionClient for
   *   reads and writes.
   * @param action Optional label for metrics/logging.
   */
  async transaction<T = void>(
    fn: (txn: TransactionClient) => Promise<T>,
    action: string = 'generic',
  ): Promise<T> {
    return this.retryTransaction(
      (client) => new TransactionClient(client),
      fn,
      action,
    );
  }

  private async retryTransaction<ClientType extends Executable, T = void>(
    ctor: (client: RedisClientType) => ClientType,
    fn: (txn: ClientType) => Promise<T>,
    action: string = 'generic',
  ): Promise<T> {
    let attempt = 0;

    while (true) {
      attempt++;
      try {
        const result = await this.client.executeIsolated(
          async (isolatedClient) => {
            const txn = ctor(isolatedClient);
            const res = await fn(txn);
            await txn.exec();
            return res;
          },
        );
        return result;
      } catch (e) {
        if (e instanceof WatchError) {
          logger.debug('watch_transaction_retry', { attempt, action });
          recordWatchConflict(action);
        } else {
          throw e;
        }
      }
    }
  }
}

interface Executable {
  exec(): Promise<void>;
}
