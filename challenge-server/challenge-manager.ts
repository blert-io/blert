import {
  ACTIVITY_FEED_KEY,
  ActivityFeedData,
  ActivityFeedItemType,
  activePlayerKey,
  CHALLENGE_UPDATES_PUBSUB_KEY,
  ChallengeMode,
  challengesKey,
  ChallengeServerUpdate,
  ChallengeStatus,
  ChallengeType,
  ChallengeUpdateAction,
  challengeStageStreamKey,
  challengeStreamsSetKey,
  CLIENT_EVENTS_KEY,
  ClientEvent,
  ClientEventType,
  clientChallengesKey,
  ClientStageStream,
  ClientStatus,
  ClientStatusEvent,
  DataRepository,
  partyKeyChallengeList,
  PriceTracker,
  RecordingType,
  SESSION_ACTIVITY_DURATION_MS,
  Stage,
  StageStatus,
  stageStreamFromRecord,
  sessionKey,
  StageStreamType,
} from '@blert/common';
import { RedisClientType, WatchError, commandOptions } from 'redis';
import { v4 as uuidv4 } from 'uuid';
import { Logger } from 'winston';

import {
  ChallengeProcessor,
  ChallengeState,
  ReportedTimes,
  loadChallengeProcessor,
  newChallengeProcessor,
} from './event-processing';
import logger, { runWithLogContext } from './log';
import {
  ChallengeInfo,
  ClientEvents,
  MergeClient,
  MergeClientStatus,
  MergeResult,
  Merger,
} from './merging';
import {
  incrementClientEventProcessed,
  observeMergeDuration,
  observeStageProcessingDuration,
  recordChallengeFinalization,
  recordChallengeRequest,
  recordCleanupAttempt,
  recordClientAnomaly,
  recordClientReconnect,
  recordClientReportedTimePrecision,
  recordFinishRequest,
  recordMergeAlert,
  recordMergeClient,
  recordReconnectionTimer,
  recordRepositoryWrite,
  recordSessionWatchdogRun,
  recordStageCompletion,
  recordStageEventPayload,
  recordStageStart,
  recordTimeoutEvent,
  recordWatchConflict,
  setClientEventQueueDepth,
  type ChallengeRequestAction,
  type ChallengeRequestDecision,
  type ClientEventStatusLabel,
  type FinalizationPath,
  type FinishRequestResult,
} from './metrics';
import { timeOperation } from './time';

export const enum ChallengeErrorType {
  FAILED_PRECONDITION,
  UNSUPPORTED,
  INTERNAL,
}

export class ChallengeError extends Error {
  public readonly type: ChallengeErrorType;

  public constructor(type: ChallengeErrorType, message: string) {
    super(message);
    this.type = type;
  }
}

/**
 * The action a client should take when starting a challenge.
 */
const enum StartAction {
  /** No action yet assigned. */
  UNKNOWN,

  /** The client should create the challenge. */
  CREATE,

  /**
   * The challenge already exists, and the client should join immediately.
   */
  IMMEDIATE_JOIN,

  /**
   * The challenge is in the process of being created, and the client should
   * block until it is ready.
   */
  DEFERRED_JOIN,
}

const enum CleanupStatus {
  OK,
  ACTIVE_CLIENTS,
  PROCESSING_STAGE,
  CHALLENGE_NOT_FOUND,
  CHALLENGE_FAILED_CLEANUP,
}

const DEFERRED_JOIN_MAX_RETRIES = 10;
const DEFERRED_JOIN_RETRY_INTERVAL_MS = 25;

const enum TimeoutState {
  NONE = 0,
  STAGE_END = 1,
  CHALLENGE_END = 2,
  CLEANUP = 3,
}

const enum LifecycleState {
  INITIALIZING,
  ACTIVE,
  CLEANUP,
}

type ExtendedChallengeState = ChallengeState & {
  state: LifecycleState;
  timeoutState: TimeoutState;
  /** Timestamp at which stage processing began. */
  processingStage: number | null;
};

type RedisChallengeState = Record<keyof ExtendedChallengeState, string>;

/** A client connected to an active challenge. */
type ChallengeClient = {
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

function toRedis(
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

function fromRedis(state: RedisChallengeState): ExtendedChallengeState {
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

function maxAttempt(a: number | null, b: number | null): number | null {
  if (a === null && b === null) {
    return null;
  }
  if (a === null) {
    return b;
  }
  if (b === null) {
    return a;
  }
  return Math.max(a, b);
}

function stageAndAttempt(stage: Stage, attempt: number | null): string {
  return `${stage}${attempt !== null ? `:${attempt}` : ''}`;
}

export type SimpleStageUpdate = {
  stage: Stage;
  status: StageStatus;
};

export type StageUpdate = SimpleStageUpdate & {
  accurate: boolean;
  recordedTicks: number;
  serverTicks: {
    count: number;
    precise: boolean;
  } | null;
};

export type ChallengeUpdate = {
  mode: ChallengeMode;
  stage?: SimpleStageUpdate;
};

export type ChallengeStatusResponse = {
  uuid: string;
  mode: ChallengeMode;
  stage: Stage;
  stageAttempt: number | null;
};

type StartActionDecision =
  | { action: StartAction.CREATE; uuid: string; sessionId: number | null }
  | { action: StartAction.DEFERRED_JOIN; uuid: string }
  | {
      action: StartAction.IMMEDIATE_JOIN;
      uuid: string;
      response: ChallengeStatusResponse;
    };

function createChallengeClient(
  userId: number,
  recordingType: RecordingType,
  stage: Stage,
  stageAttempt: number | null = null,
): ChallengeClient {
  return {
    userId,
    type: recordingType,
    active: true,
    stage,
    stageAttempt,
    stageStatus: StageStatus.ENTERED,
    lastCompleted: {
      stage: Stage.UNKNOWN,
      attempt: null,
    },
  };
}

function challengeClientsKey(challengeId: string): string {
  return `challenge:${challengeId}:clients`;
}

function challengeProcessedStagesKey(challengeId: string): string {
  return `challenge:${challengeId}:processed-stages`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Redis expires are in seconds.
const SESSION_ACTIVITY_DURATION_S = SESSION_ACTIVITY_DURATION_MS / 1000;

export default class ChallengeManager {
  private challengeDataRepository: DataRepository;
  private testDataRepository: DataRepository;
  private priceTracker: PriceTracker;
  private client: RedisClientType;
  private eventClient: RedisClientType;
  private eventQueueActive: boolean;

  private manageTimeouts: boolean;
  private timeoutTaskTimer: NodeJS.Timeout | null;
  private sessionWatchdog: SessionWatchdog;

  private static readonly CHALLENGE_TIMEOUT_KEY = 'expiring-challenges';
  private static readonly CHALLENGE_TIMEOUT_INTERVAL = 500;

  /** How long to wait before cleaning up a challenge with no clients. */
  private static readonly MAX_RECONNECTION_PERIOD = 1000 * 60 * 5;

  /**
   * How long to wait before attempting to clean up a challenge not
   * receiving events.
   */
  private static readonly MAX_INACTIVITY_PERIOD = 1000 * 60 * 15;

  /**
   * Maximum time to wait for every client in a challenge to send their stage
   * end event following the first client's completion.
   */
  private static readonly STAGE_END_TIMEOUT = 2000;

  /**
   * Maximum time to wait for a stage to be processed.
   * Beyond this time, the processing step is considered to have failed.
   */
  private static readonly MAX_STAGE_PROCESSING_TIME = 1000 * 30;
  private static readonly STAGE_PROCESSING_RETRY_INTERVAL = 1500;

  public constructor(
    challengeDataRepository: DataRepository,
    testDataRepository: DataRepository,
    client: RedisClientType,
    manageTimeouts: boolean,
  ) {
    this.challengeDataRepository = challengeDataRepository;
    this.testDataRepository = testDataRepository;
    this.priceTracker = new PriceTracker();
    this.client = client;
    this.eventClient = client.duplicate();
    this.eventQueueActive = true;

    this.sessionWatchdog = new SessionWatchdog(client.duplicate());

    this.manageTimeouts = manageTimeouts;
    if (this.manageTimeouts) {
      this.timeoutTaskTimer = setTimeout(() => {
        void this.processChallengeTimeouts();
      }, ChallengeManager.CHALLENGE_TIMEOUT_INTERVAL);
      void this.sessionWatchdog.run();
    } else {
      this.timeoutTaskTimer = null;
    }

    setTimeout(() => {
      void this.processEvents();
    }, 100);
  }

  /**
   * Creates a new challenge for the given party or joins an existing one.
   *
   * @param userId ID of the challenge client.
   * @param type Type of challenge.
   * @param mode Mode of challenge.
   * @param stage Stage of challenge.
   * @param party Party members.
   * @param recordingType Type of recording.
   * @returns The challenge's UUID.
   * @throws ChallengeError if a challenge could not be created or joined.
   */
  public async createOrJoin(
    userId: number,
    type: ChallengeType,
    mode: ChallengeMode,
    stage: Stage,
    party: string[],
    recordingType: RecordingType,
  ): Promise<ChallengeStatusResponse> {
    let requestAction: ChallengeRequestAction = 'create';
    let requestDecision: ChallengeRequestDecision = 'error';

    try {
      if (mode === ChallengeMode.TOB_ENTRY) {
        requestDecision = 'rejected';
        throw new ChallengeError(
          ChallengeErrorType.UNSUPPORTED,
          'ToB entry mode challenges are not supported',
        );
      }

      const sk = sessionKey(type, party);

      let statusResponse: ChallengeStatusResponse | null = null;

      const decision = await this.determineStartAction(
        userId,
        type,
        recordingType,
        stage,
        party,
        sk,
      );

      requestAction =
        decision.action === StartAction.CREATE ? 'create' : 'join';

      switch (decision.action) {
        case StartAction.CREATE: {
          statusResponse = await this.handleChallengeCreate(
            decision.uuid,
            decision.sessionId,
            userId,
            recordingType,
            type,
            mode,
            stage,
            party,
            sk,
          );
          requestDecision = 'accepted';
          break;
        }

        case StartAction.DEFERRED_JOIN: {
          statusResponse = await this.handleChallengeDeferredJoin(
            decision.uuid,
            userId,
            recordingType,
          );
          requestDecision = 'deferred';
          break;
        }

        case StartAction.IMMEDIATE_JOIN: {
          // No additional action is required here as the client was already
          // added in the initial transaction.
          statusResponse = decision.response;
          requestDecision = 'accepted';
          break;
        }
      }

      await ChallengeProcessor.addRecorder(
        decision.uuid,
        userId,
        recordingType,
      );

      return statusResponse;
    } finally {
      recordChallengeRequest(
        requestAction,
        type,
        mode,
        recordingType,
        requestDecision,
      );
    }
  }

  private async determineStartAction(
    userId: number,
    type: ChallengeType,
    recordingType: RecordingType,
    stage: Stage,
    party: string[],
    partySessionKey: string,
  ): Promise<StartActionDecision> {
    let decision: StartActionDecision | null = null;

    const logChallengeJoinDecision = (
      action: StartAction,
      reason: string,
      meta: Record<string, unknown> = {},
      level: 'info' | 'warn' = 'info',
    ) => {
      logger[level]('challenge_join_decision', {
        userId,
        type,
        stage,
        party,
        action,
        reason,
        ...meta,
      });
    };

    const partyKeyList = partyKeyChallengeList(type, party);

    // Requests from multiple clients in the same party may arrive around the
    // same time, so we need to ensure that only one challenge is created for
    // the party.
    await this.watchTransaction(async (client) => {
      // Reset state in case we had to retry the transaction.
      decision = null;

      let startAction = StartAction.UNKNOWN;

      await Promise.all([
        client.watch(partyKeyList),
        client.watch(partySessionKey),
      ]);
      const multi = client.multi();

      const lastChallengeForParty = await client.lIndex(partyKeyList, -1);
      if (lastChallengeForParty !== null) {
        const key = challengesKey(lastChallengeForParty);
        await client.watch(key);

        const [
          stateValue,
          modeValue,
          statusValue,
          stageValue,
          stageAttemptValue,
          timeoutStateValue,
        ] = await client.hmGet(key, [
          'state',
          'mode',
          'status',
          'stage',
          'stageAttempt',
          'timeoutState',
        ]);

        const lifecycleState =
          stateValue !== null
            ? (Number.parseInt(stateValue) as LifecycleState)
            : null;

        if (
          lifecycleState === null ||
          lifecycleState === LifecycleState.CLEANUP ||
          statusValue === null ||
          stageValue === null
        ) {
          logChallengeJoinDecision(
            StartAction.CREATE,
            'challenge_not_found',
            { lastChallengeForParty },
            'warn',
          );
          multi.rPop(partyKeyList);
          startAction = StartAction.CREATE;
        } else {
          const status = Number.parseInt(statusValue) as ChallengeStatus;
          const timeoutState = Number.parseInt(
            timeoutStateValue,
          ) as TimeoutState;
          const lastStage = Number.parseInt(stageValue) as Stage;

          if (
            status === ChallengeStatus.COMPLETED ||
            timeoutState === TimeoutState.CHALLENGE_END
          ) {
            logChallengeJoinDecision(
              StartAction.CREATE,
              'previous_challenge_completed',
              { lastChallengeForParty },
            );
            startAction = StartAction.CREATE;
          } else if (stage !== Stage.UNKNOWN && stage < lastStage) {
            logChallengeJoinDecision(StartAction.CREATE, 'earlier_stage', {
              lastChallengeForParty,
              stage,
              lastStage,
            });
            startAction = StartAction.CREATE;
          } else if (lifecycleState === LifecycleState.INITIALIZING) {
            logChallengeJoinDecision(
              StartAction.DEFERRED_JOIN,
              'challenge_initializing',
              { joiningChallenge: lastChallengeForParty },
            );
            startAction = StartAction.DEFERRED_JOIN;
            decision = {
              action: StartAction.DEFERRED_JOIN,
              uuid: lastChallengeForParty,
            };
          } else {
            logChallengeJoinDecision(
              StartAction.IMMEDIATE_JOIN,
              'challenge_active',
              { joiningChallenge: lastChallengeForParty },
            );

            startAction = StartAction.IMMEDIATE_JOIN;
            decision = {
              action: StartAction.IMMEDIATE_JOIN,
              uuid: lastChallengeForParty,
              response: {
                uuid: lastChallengeForParty,
                mode: Number.parseInt(modeValue) as ChallengeMode,
                stage: Number.parseInt(stageValue) as Stage,
                stageAttempt: stageAttemptValue
                  ? Number.parseInt(stageAttemptValue)
                  : null,
              },
            };

            const challengeClient = createChallengeClient(
              userId,
              recordingType,
              decision.response.stage,
              decision.response.stageAttempt,
            );

            multi.set(clientChallengesKey(userId), lastChallengeForParty);
            multi.hSet(
              challengeClientsKey(lastChallengeForParty),
              userId,
              JSON.stringify(challengeClient),
            );

            // Refresh the session duration.
            multi.expire(partySessionKey, SESSION_ACTIVITY_DURATION_S, 'GT');
          }
        }
      } else {
        logChallengeJoinDecision(StartAction.CREATE, 'new_challenge');
        startAction = StartAction.CREATE;
      }

      if (startAction === StartAction.CREATE) {
        // Generate a UUID for the new challenge and set the minimum required
        // fields for other clients to recognize the challenge is initializing.
        const challengeUuid = uuidv4();
        multi.rPush(partyKeyList, challengeUuid);
        multi.hSet(
          challengesKey(challengeUuid),
          toRedis({
            state: LifecycleState.INITIALIZING,
            status: ChallengeStatus.IN_PROGRESS,
            stage,
            timeoutState: TimeoutState.NONE,
          }),
        );

        const sessionIdValue = await client.get(partySessionKey);
        decision = {
          action: StartAction.CREATE,
          uuid: challengeUuid,
          sessionId: sessionIdValue ? Number.parseInt(sessionIdValue) : null,
        };
      } else if (decision !== null) {
        // If a client is joining a challenge that is due for cleanup, reset
        // its timeout state to allow the challenge to continue.
        const timeoutState = await client.hGet(
          challengesKey(decision.uuid),
          'timeoutState',
        );
        if (
          timeoutState !== undefined &&
          (Number.parseInt(timeoutState) as TimeoutState) ===
            TimeoutState.CLEANUP
        ) {
          multi.hSet(
            challengesKey(decision.uuid),
            'timeoutState',
            TimeoutState.NONE,
          );
        }
      }

      return multi.exec();
    }, 'challenge_start');

    if (decision === null) {
      // This should never happen as the transaction should always set these
      // values, but log some basic debugging information just in case.
      logger.error('challenge_start_failed', {
        userId,
        type,
        stage,
        party,
      });
      throw new Error('Failed to start challenge');
    }

    return decision;
  }

  private async handleChallengeCreate(
    uuid: string,
    sessionId: number | null,
    userId: number,
    recordingType: RecordingType,
    type: ChallengeType,
    mode: ChallengeMode,
    stage: Stage,
    party: string[],
    partySessionKey: string,
  ): Promise<ChallengeStatusResponse> {
    // This client is responsible for creating the challenge in the
    // database. Once that is done, activate the challenge and update its
    // Redis state from its challenge processor.

    const startTime = new Date();
    let processor: ChallengeProcessor;

    try {
      processor = newChallengeProcessor(
        this.challengeDataRepository,
        this.priceTracker,
        uuid,
        type,
        mode,
        stage,
        StageStatus.ENTERED,
        party,
      );

      await processor.createNew(startTime, sessionId);
    } catch (e: unknown) {
      logger.error('challenge_create_failed', {
        userId,
        challengeUuid: uuid,
        type,
        mode,
        stage,
        party,
        error: e instanceof Error ? e : new Error(String(e)),
      });

      await this.deleteRedisChallengeData(uuid, type, party);

      if (e instanceof ChallengeError) {
        throw e;
      }
      throw new ChallengeError(
        ChallengeErrorType.INTERNAL,
        'Failed to create challenge',
      );
    }

    const challengeClient = createChallengeClient(userId, recordingType, stage);

    await this.watchTransaction(async (client) => {
      await client.watch(partySessionKey);

      const multi = client
        .multi()
        .hSet(challengesKey(uuid), {
          ...toRedis(processor.getState()),
          state: LifecycleState.ACTIVE,
        })
        .hSet(
          challengeClientsKey(uuid),
          userId,
          JSON.stringify(challengeClient),
        )
        .set(clientChallengesKey(userId), uuid)
        .set(partySessionKey, processor.getSessionId(), {
          EX: SESSION_ACTIVITY_DURATION_S,
        });

      for (const player of party) {
        multi.set(activePlayerKey(player), uuid);
      }

      return multi.exec();
    }, 'challenge_create');

    logger.info('challenge_created', {
      userId,
      challengeUuid: uuid,
      sessionId: processor.getSessionId(),
      type,
      mode,
      stage,
      party,
    });

    return {
      uuid,
      mode,
      stage,
      stageAttempt: processor.getStageAttempt(),
    };
  }

  private async handleChallengeDeferredJoin(
    uuid: string,
    userId: number,
    recordingType: RecordingType,
  ): Promise<ChallengeStatusResponse> {
    // Another client is simultaneously creating the challenge. Wait until
    // it is ready, then have this client join it.
    const key = challengesKey(uuid);
    let retries = 0;

    let statusResponse: ChallengeStatusResponse | null = null;

    while (retries < DEFERRED_JOIN_MAX_RETRIES) {
      let complete = false;

      await this.watchTransaction(async (client) => {
        await client.watch(key);

        complete = false;
        const multi = client.multi();

        const [state, modeValue, stageValue, stageAttemptValue] =
          await client.hmGet(key, ['state', 'mode', 'stage', 'stageAttempt']);
        const lifecycleState =
          state !== undefined
            ? (Number.parseInt(state) as LifecycleState)
            : null;

        if (
          lifecycleState === null ||
          lifecycleState === LifecycleState.CLEANUP
        ) {
          logger.error('deferred_join_missing_challenge', {
            challengeUuid: uuid,
            userId,
            lifecycleState,
          });
          throw new ChallengeError(
            ChallengeErrorType.INTERNAL,
            `Challenge ${uuid} no longer exists`,
          );
        }

        if (lifecycleState === LifecycleState.ACTIVE) {
          complete = true;

          statusResponse = {
            uuid,
            mode: Number.parseInt(modeValue) as ChallengeMode,
            stage: Number.parseInt(stageValue) as Stage,
            stageAttempt: stageAttemptValue
              ? Number.parseInt(stageAttemptValue)
              : null,
          };

          const challengeClient = createChallengeClient(
            userId,
            recordingType,
            statusResponse.stage,
            statusResponse.stageAttempt,
          );

          multi.set(clientChallengesKey(userId), uuid);
          multi.hSet(
            challengeClientsKey(uuid),
            userId,
            JSON.stringify(challengeClient),
          );
        }

        return multi.exec();
      }, 'deferred_join');

      if (complete) {
        break;
      }

      const delayMs = DEFERRED_JOIN_RETRY_INTERVAL_MS * 2 ** retries;
      await delay(Math.min(delayMs, 250));
      retries++;
    }

    if (retries === DEFERRED_JOIN_MAX_RETRIES) {
      logger.error('deferred_join_max_retries', {
        challengeUuid: uuid,
        userId,
        retries,
      });
      throw new ChallengeError(
        ChallengeErrorType.INTERNAL,
        `Failed to join challenge ${uuid} for user ${userId} after ${retries} attempts`,
      );
    }

    logger.info('deferred_join_success', {
      challengeUuid: uuid,
      userId,
      retries,
    });

    return statusResponse!;
  }

  /**
   * Indicates that the client with the given ID has finished a challenge.
   * @param challengeId The challenge ID.
   * @param userId ID of the challenge client.
   */
  public async finish(
    challengeId: string,
    userId: number,
    reportedTimes: ReportedTimes | null = null,
  ): Promise<void> {
    const currentChallenge = await this.client.get(clientChallengesKey(userId));
    if (currentChallenge !== challengeId) {
      logger.warn('finish_challenge_not_in_challenge', {
        userId,
        challengeUuid: challengeId,
        currentChallenge,
      });
      recordFinishRequest(false, 'rejected');
      return;
    }

    const challengeKey = challengesKey(challengeId);

    let allClientsFinished = false;
    let result: string | null = null;
    let metricResult: FinishRequestResult = 'error';

    try {
      await this.watchTransaction(async (client) => {
        // Reset allClientsFinished in case we had to retry the transaction.
        allClientsFinished = false;
        result = null;

        await client.watch(challengeKey);
        await client.watch(challengeClientsKey(challengeId));
        const multi = client.multi();

        multi.del(clientChallengesKey(userId));

        const challenge = await this.loadChallenge(challengeId, client);
        if (challenge === null || challenge.state !== LifecycleState.ACTIVE) {
          result = 'challenge_not_active';
          return multi.exec();
        }

        // As there is activity, refresh the challenge's session duration.
        multi.expire(
          sessionKey(challenge.type, challenge.party),
          SESSION_ACTIVITY_DURATION_S,
          'GT',
        );

        const clients = await this.loadChallengeClients(challengeId, client);
        const self = clients.find((c) => c.userId === userId);
        if (self === undefined) {
          result = 'not_in_challenge';
          return multi.exec();
        }

        let timeout: ChallengeTimeout;

        allClientsFinished = clients.length === 1;
        if (!allClientsFinished) {
          // If there are still clients connected, set a timeout to allow
          // their own finish requests to complete.
          //
          // However, spectators may just leave a challenge early before it has
          // actually finished, so don't count their end times as definitive.
          // Instead, start a longer cleanup timer which will end the challenge
          // unless other activity is detected.
          const hasDefinitelyFinished =
            self.type === RecordingType.PARTICIPANT || reportedTimes !== null;

          if (
            hasDefinitelyFinished ||
            challenge.timeoutState === TimeoutState.CHALLENGE_END
          ) {
            timeout = {
              timestamp: Date.now() + 1500,
              maxRetryAttempts: 3,
              retryIntervalMs: 1000,
            };
            multi.hSet(
              challengeKey,
              'timeoutState',
              TimeoutState.CHALLENGE_END,
            );
          } else {
            timeout = {
              timestamp: Date.now() + ChallengeManager.MAX_RECONNECTION_PERIOD,
              maxRetryAttempts: 1,
              retryIntervalMs: ChallengeManager.MAX_RECONNECTION_PERIOD,
            };
            multi.hSet(challengeKey, 'timeoutState', TimeoutState.CLEANUP);
          }
        } else {
          timeout = {
            timestamp: Date.now() + 1500,
            maxRetryAttempts: 3,
            retryIntervalMs: 1000,
          };
          multi.hSet(challengeKey, 'timeoutState', TimeoutState.CHALLENGE_END);
        }

        multi.hSet(
          ChallengeManager.CHALLENGE_TIMEOUT_KEY,
          challengeId,
          JSON.stringify(timeout),
        );

        multi.hDel(challengeClientsKey(challengeId), userId.toString());

        if (reportedTimes !== null) {
          multi.hSet(
            challengeKey,
            'reportedChallengeTicks',
            reportedTimes.challenge,
          );
          multi.hSet(
            challengeKey,
            'reportedOverallTicks',
            reportedTimes.overall,
          );
        }

        result = 'success';
        return multi.exec();
      });

      logger.info('challenge_finish', {
        userId,
        challengeUuid: challengeId,
        result,
        allClientsFinished,
      });

      if (result === 'success') {
        metricResult = 'accepted';
      } else if (result !== null) {
        metricResult = 'rejected';
      }
    } finally {
      recordFinishRequest(allClientsFinished, metricResult);
    }
  }

  public async update(
    challengeId: string,
    userId: number,
    update: ChallengeUpdate,
  ): Promise<ChallengeStatusResponse | null> {
    const currentChallenge = await this.client.get(clientChallengesKey(userId));
    if (currentChallenge !== challengeId) {
      if (currentChallenge === null) {
        logger.warn('challenge_update_rejected', {
          userId,
          challengeUuid: challengeId,
          reason: 'not_in_challenge',
        });
      } else {
        logger.warn('challenge_update_rejected', {
          userId,
          challengeUuid: challengeId,
          reason: 'in_other_challenge',
          currentChallenge,
        });
      }
      return null;
    }

    let result: ChallengeStatusResponse | null = null;
    let forceCleanup = false;
    let finishStage: [Stage, number | null] | null = null;
    let stageStarted: [ChallengeType, ChallengeMode, Stage] | null = null;

    await this.watchTransaction(async (client) => {
      // Reset state variables in case we had to retry the transaction.
      result = null;
      forceCleanup = false;
      finishStage = null;
      stageStarted = null;

      await client.watch(challengesKey(challengeId));
      const challenge = await this.loadChallenge(challengeId, client);
      const multi = client.multi();

      if (challenge === null) {
        logger.warn('challenge_update_rejected', {
          userId,
          challengeUuid: challengeId,
          reason: 'non_existent',
        });
        result = null;
        return multi.exec();
      }

      if (challenge.timeoutState === TimeoutState.CLEANUP) {
        multi.hSet(
          challengesKey(challengeId),
          'timeoutState',
          TimeoutState.NONE,
        );
        logger.debug('challenge_cleanup_canceled', {
          challengeUuid: challengeId,
          reason: 'client_activity',
        });
      }

      // As there is activity, refresh the challenge's session duration.
      multi.expire(
        sessionKey(challenge.type, challenge.party),
        SESSION_ACTIVITY_DURATION_S,
        'GT',
      );

      const processor = loadChallengeProcessor(
        this.challengeDataRepository,
        this.priceTracker,
        challenge,
      );

      if (update.mode !== ChallengeMode.NO_MODE) {
        // Entry mode tracking is currently disabled.
        if (update.mode === ChallengeMode.TOB_ENTRY) {
          logger.info('challenge_update_invalid_mode', {
            challengeUuid: challengeId,
            userId,
            mode: update.mode,
          });
          forceCleanup = true;
          return multi.exec();
        }

        processor.setMode(update.mode);
      }

      if (update.stage !== undefined) {
        const stageUpdate = update.stage;
        if (stageUpdate.stage < challenge.stage) {
          // TODO(frolv): Investigate log patterns to see whether this check
          // should be relaxed, e.g. a client sends a delayed finish update for
          // a previous stage.
          logger.warn('challenge_update_rejected', {
            userId,
            challengeUuid: challengeId,
            reason: 'earlier_stage',
            stage: stageUpdate.stage,
            currentStage: challenge.stage,
          });
          result = null;
          return multi.exec();
        }

        await client.watch(challengeClientsKey(challengeId));
        const clients = await this.loadChallengeClients(challengeId, client);

        const us = clients.find((c) => c.userId === userId);
        if (us === undefined) {
          logger.warn('challenge_update_rejected', {
            userId,
            challengeUuid: challengeId,
            reason: 'not_in_challenge',
          });
          result = null;
          return multi.exec();
        }

        us.stage = stageUpdate.stage;
        us.stageStatus = stageUpdate.status;
        us.active = true;

        const isFinished = (s: StageStatus) =>
          s === StageStatus.COMPLETED || s === StageStatus.WIPED;

        if (isFinished(stageUpdate.status)) {
          // The client has finished the stage. If all clients have finished,
          // the challenge stage can be finalized. Otherwise, wait for other
          // clients to complete the stage up to a maximum deadline.
          us.lastCompleted = {
            stage: stageUpdate.stage,
            attempt: us.stageAttempt,
          };

          const hasFinishedStage = (c: ChallengeClient) => {
            if (c.stage > challenge.stage) {
              return true;
            }

            if (!isFinished(c.stageStatus)) {
              return false;
            }

            return (
              maxAttempt(c.stageAttempt, challenge.stageAttempt) ===
              c.stageAttempt
            );
          };

          const numFinishedClients = clients.reduce(
            (acc, c) => (hasFinishedStage(c) ? acc + 1 : acc),
            0,
          );

          logger.debug('client_finished_stage', {
            challengeUuid: challengeId,
            userId,
            stage: stageUpdate.stage,
            attempt: us.stageAttempt,
            numFinishedClients,
            totalClients: clients.length,
          });

          if (numFinishedClients === clients.length) {
            finishStage = [stageUpdate.stage, us.stageAttempt];
            if (challenge.timeoutState !== TimeoutState.CHALLENGE_END) {
              multi.hSet(
                challengesKey(challengeId),
                'timeoutState',
                TimeoutState.NONE,
              );
            }
          } else if (challenge.timeoutState !== TimeoutState.STAGE_END) {
            const timeout: ChallengeTimeout = {
              timestamp: Date.now() + ChallengeManager.STAGE_END_TIMEOUT,
              maxRetryAttempts: 0,
              retryIntervalMs: 0,
            };
            multi.hSet(
              challengesKey(challengeId),
              'timeoutState',
              TimeoutState.STAGE_END,
            );
            multi.hSet(
              ChallengeManager.CHALLENGE_TIMEOUT_KEY,
              challengeId,
              JSON.stringify(timeout),
            );
          }
        } else if (stageUpdate.status === StageStatus.STARTED) {
          // Handle multiple clients in the challenge starting the same stage
          // at once. There are two cases:
          //
          // 1. The clients are starting a new stage.
          //    a. The first client's request is different to the challenge's
          //       current stage. It updates the challenge's stage.
          //    b. Subsequent clients' requests will have the same stage, and
          //       will be handled by the attempt behavior in case 2.
          //
          // 2. The clients are restarting the same stage. The stage may or may
          //    not be retriable.
          //    a. The first client's current attempt number will be equal to
          //       the challenge's current attempt number. The client will try
          //       to start the stage again (failing if it is not retriable).
          //    b. Subsequent clients' requests will have an attempt lower than
          //       that of the challenge. Their current attempt number will be
          //       advanced to match the challenge.
          //       This additionally handles case 1b, as each client will
          //       be brought up to the challenge's new stage and attempt.
          //
          const isNewStage = stageUpdate.stage !== processor.getStage();
          if (isNewStage) {
            processor.startStage(stageUpdate.stage);
            stageStarted = [challenge.type, challenge.mode, stageUpdate.stage];
          } else {
            const isCurrentAttempt =
              us.stage === processor.getStage() &&
              processor.getStageAttempt() !== null &&
              us.stageAttempt === processor.getStageAttempt();

            if (isCurrentAttempt) {
              processor.startStage(stageUpdate.stage);
              stageStarted = [
                challenge.type,
                challenge.mode,
                stageUpdate.stage,
              ];
            }
          }

          us.stageAttempt = processor.getStageAttempt();
        }

        multi.hSet(
          challengeClientsKey(challengeId),
          userId,
          JSON.stringify(us),
        );
      }

      const updates = await processor.finalizeUpdates();
      result = {
        uuid: challengeId,
        mode: challenge.mode,
        stage: challenge.stage,
        stageAttempt: challenge.stageAttempt,
      };

      if (Object.keys(updates).length > 0) {
        multi.hSet(challengesKey(challengeId), toRedis(updates));
        result = { ...result, ...updates };
      }

      return multi.exec();
    });

    if (stageStarted !== null) {
      recordStageStart(stageStarted[0], stageStarted[1], stageStarted[2]);
    }

    if (forceCleanup) {
      await this.cleanupChallenge(challengeId, null, 'forced_cleanup');
    } else if (finishStage !== null) {
      const [stageToComplete, attemptToComplete] = finishStage as [
        Stage,
        number | null,
      ];
      await this.client.hSet(
        challengesKey(challengeId),
        'processingStage',
        Date.now().toString(),
      );
      setTimeout(() => {
        void this.loadAndCompleteChallengeStage(
          challengeId,
          stageToComplete,
          attemptToComplete,
        );
      }, 0);
    }

    return result;
  }

  /**
   * Adds a client to an existing challenge.
   * @param challengeId ID of the challenge to join.
   * @param userId ID of the client.
   * @param recordingType Type of client recording.
   * @returns The current status of the joined challenge.
   * @throws ChallengeError if the join fails.
   */
  public async addClient(
    challengeId: string,
    userId: number,
    recordingType: RecordingType,
  ): Promise<ChallengeStatusResponse> {
    let metricDecision: ChallengeRequestDecision = 'error';

    try {
      const currentChallenge = await this.client.get(
        clientChallengesKey(userId),
      );
      if (currentChallenge !== null) {
        logger.warn('challenge_join_rejected', {
          userId,
          challengeUuid: challengeId,
          reason: 'already_in_challenge',
          currentChallenge,
        });
        metricDecision = 'rejected';
        throw new ChallengeError(
          ChallengeErrorType.FAILED_PRECONDITION,
          'User is already in a challenge',
        );
      }

      let statusResponse: ChallengeStatusResponse | null = null;

      await this.watchTransaction(async (client) => {
        await Promise.all([
          client.watch(challengesKey(challengeId)),
          client.watch(challengeClientsKey(challengeId)),
        ]);
        const multi = client.multi();

        statusResponse = null;

        const [challenge, clients] = await Promise.all([
          this.loadChallenge(challengeId, client),
          this.loadChallengeClients(challengeId, client),
        ]);

        if (challenge === null || challenge.state !== LifecycleState.ACTIVE) {
          logger.warn('challenge_join_rejected', {
            userId,
            challengeUuid: challengeId,
            reason: 'non_existent',
          });
          metricDecision = 'rejected';
          return multi.exec();
        }

        const clientInfo: ChallengeClient = {
          userId,
          type: recordingType,
          active: true,
          stage: challenge.stage,
          stageAttempt: challenge.stageAttempt ?? null,
          stageStatus: StageStatus.ENTERED,
          lastCompleted: {
            stage: Stage.UNKNOWN,
            attempt: null,
          },
        };
        multi.hSet(
          challengeClientsKey(challengeId),
          userId,
          JSON.stringify(clientInfo),
        );

        const allInactive = clients.every((c) => !c.active);
        if (allInactive && challenge.timeoutState === TimeoutState.CLEANUP) {
          logger.info('challenge_cleanup_canceled', {
            userId,
            challengeUuid: challengeId,
            stage: clientInfo.stage,
            attempt: clientInfo.stageAttempt,
            reason: 'client_reconnected',
          });

          // Pause any pending cleanup if the challenge was previously inactive.
          multi.hSet(
            challengesKey(challengeId),
            'timeoutState',
            TimeoutState.NONE,
          );
          multi.hDel(ChallengeManager.CHALLENGE_TIMEOUT_KEY, challengeId);
        }

        logger.info('client_reconnected', {
          userId,
          challengeUuid: challengeId,
          stage: clientInfo.stage,
          attempt: clientInfo.stageAttempt,
        });

        multi.set(clientChallengesKey(userId), challengeId);

        statusResponse = {
          uuid: challengeId,
          mode: challenge.mode,
          stage: clientInfo.stage,
          stageAttempt: clientInfo.stageAttempt,
        };

        return multi.exec();
      });

      if (statusResponse === null) {
        metricDecision = 'rejected';
        throw new ChallengeError(
          ChallengeErrorType.FAILED_PRECONDITION,
          'Challenge does not exist',
        );
      }

      metricDecision = 'accepted';
      return statusResponse;
    } catch (e) {
      logger.error('client_reconnect_error', {
        userId,
        challengeUuid: challengeId,
        recordingType,
        error: e instanceof Error ? e : new Error(String(e)),
      });
      throw e;
    } finally {
      recordClientReconnect(recordingType, metricDecision);
    }
  }

  private async processEvents() {
    this.eventClient.on('error', (err) => {
      logger.error('redis_error', {
        key: CLIENT_EVENTS_KEY,
        error: err instanceof Error ? err : new Error(String(err)),
      });
    });
    await this.eventClient.connect();

    while (this.eventQueueActive) {
      const res = await this.eventClient.blPop(CLIENT_EVENTS_KEY, 60);
      if (res === null) {
        // Hit the timeout; simply try again.
        continue;
      }

      await this.updateClientEventQueueDepth();

      const event = JSON.parse(res.element) as ClientEvent;

      const clientChallenge = await this.eventClient.get(
        clientChallengesKey(event.userId),
      );
      if (clientChallenge === null) {
        continue;
      }

      if (event.type === ClientEventType.STATUS) {
        const statusEvent = event as ClientStatusEvent;
        let statusLabel: ClientEventStatusLabel | null = null;
        switch (statusEvent.status) {
          case ClientStatus.ACTIVE:
            await this.setClientActive(event.userId, clientChallenge);
            statusLabel = 'active';
            break;
          case ClientStatus.IDLE:
            await this.setClientInactive(event.userId, clientChallenge);
            statusLabel = 'idle';
            break;
          case ClientStatus.DISCONNECTED:
            await this.removeClient(event.userId, clientChallenge);
            statusLabel = 'disconnected';
            break;
        }

        if (statusLabel !== null) {
          incrementClientEventProcessed(statusLabel);
        }
      }
    }

    await this.eventClient.disconnect();
  }

  private async removeClient(id: number, challengeId: string): Promise<void> {
    const challenge = challengesKey(challengeId);

    await this.client.executeIsolated(async (client) => {
      await client.watch(challenge);
      const multi = client.multi();

      multi.del(clientChallengesKey(id));
      multi.hDel(challengeClientsKey(challengeId), id.toString());

      const lifecycleState = await client.hGet(challenge, 'state');
      if (
        lifecycleState === null ||
        lifecycleState === LifecycleState.CLEANUP.toString()
      ) {
        logger.warn('client_remove_rejected', {
          userId: id,
          challengeUuid: challengeId,
          reason: 'non_existent',
        });
        return multi.exec();
      }

      const clients = await this.loadChallengeClients(challengeId, client);

      if (clients.length <= 1) {
        const timeout: ChallengeTimeout = {
          timestamp: Date.now() + ChallengeManager.MAX_RECONNECTION_PERIOD,
          maxRetryAttempts: 3,
          retryIntervalMs: ChallengeManager.MAX_RECONNECTION_PERIOD,
        };
        multi.hSet(
          challengesKey(challengeId),
          'timeoutState',
          TimeoutState.CLEANUP,
        );
        multi.hSet(
          ChallengeManager.CHALLENGE_TIMEOUT_KEY,
          challengeId,
          JSON.stringify(timeout),
        );

        logger.info('challenge_reconnection_timer_started', {
          challengeUuid: challengeId,
          timeout: ChallengeManager.MAX_RECONNECTION_PERIOD,
        });
        recordReconnectionTimer('disconnect');
      }

      return multi.exec();
    });
  }

  private async updateClientEventQueueDepth(): Promise<void> {
    try {
      const length = await this.eventClient.lLen(CLIENT_EVENTS_KEY);
      setClientEventQueueDepth(length);
    } catch (err) {
      logger.warn('client_event_queue_depth_failed', {
        error: err instanceof Error ? err : new Error(String(err)),
      });
    }
  }

  private async setClientActive(
    id: number,
    challengeId: string,
  ): Promise<void> {
    if ((await this.client.get(clientChallengesKey(id))) !== challengeId) {
      return;
    }

    const clientsKey = challengeClientsKey(challengeId);

    await this.watchTransaction(async (client) => {
      await client.watch(clientsKey);
      const multi = client.multi();

      const [challenge, clients] = await Promise.all([
        this.loadChallenge(challengeId, client),
        this.loadChallengeClients(challengeId, client),
      ]);

      if (challenge === null) {
        multi.hDel(clientsKey, id.toString());
        multi.del(clientChallengesKey(id));
        return multi.exec();
      }

      const us = clients.find((c) => c.userId === id);
      if (us === undefined) {
        logger.warn('client_not_in_challenge', {
          userId: id,
          challengeUuid: challengeId,
          operation: 'set_client_active',
        });
        multi.del(clientChallengesKey(id));
        return multi.exec();
      }

      if (us.active) {
        return multi.exec();
      }

      logger.debug('client_reconnected', {
        challengeId,
        userId: id,
      });
      us.active = true;

      multi.hSet(clientsKey, id, JSON.stringify(us));
      if (challenge.timeoutState === TimeoutState.CLEANUP) {
        multi.hSet(
          challengesKey(challengeId),
          'timeoutState',
          TimeoutState.NONE,
        );
        multi.hDel(ChallengeManager.CHALLENGE_TIMEOUT_KEY, challengeId);
      }

      return multi.exec();
    });
  }

  private async setClientInactive(
    id: number,
    challengeId: string,
  ): Promise<void> {
    if ((await this.client.get(clientChallengesKey(id))) !== challengeId) {
      return;
    }

    const clientsKey = challengeClientsKey(challengeId);

    await this.watchTransaction(async (client) => {
      await client.watch(clientsKey);
      const multi = client.multi();

      const [challenge, clients] = await Promise.all([
        this.loadChallenge(challengeId, client),
        this.loadChallengeClients(challengeId, client),
      ]);

      if (challenge === null) {
        multi.hDel(clientsKey, id.toString());
        multi.del(clientChallengesKey(id));
        return multi.exec();
      }

      const us = clients.find((c) => c.userId === id);
      if (us === undefined) {
        logger.warn('client_not_in_challenge', {
          userId: id,
          challengeUuid: challengeId,
          operation: 'set_client_inactive',
        });
        multi.del(clientChallengesKey(id));
        return multi.exec();
      }

      if (!us.active) {
        return multi.exec();
      }

      logger.debug('client_disconnected', {
        challengeUuid: challengeId,
        userId: id,
      });
      us.active = false;
      multi.hSet(clientsKey, id, JSON.stringify(us));

      const allInactive = clients.every((c) => !c.active);
      if (allInactive && challenge.timeoutState === TimeoutState.NONE) {
        logger.info('challenge_reconnection_timer_started', {
          challengeUuid: challengeId,
          timeout: ChallengeManager.MAX_INACTIVITY_PERIOD,
        });
        recordReconnectionTimer('all_inactive');
        const timeout: ChallengeTimeout = {
          timestamp: Date.now() + ChallengeManager.MAX_INACTIVITY_PERIOD,
          maxRetryAttempts: 0,
          retryIntervalMs: ChallengeManager.MAX_INACTIVITY_PERIOD,
        };
        multi.hSet(
          ChallengeManager.CHALLENGE_TIMEOUT_KEY,
          challengeId,
          JSON.stringify(timeout),
        );
        multi.hSet(
          challengesKey(challengeId),
          'timeoutState',
          TimeoutState.CLEANUP,
        );
      }

      return multi.exec();
    });
  }

  private async loadAndCompleteChallengeStage(
    challengeId: string,
    stage: Stage,
    attempt: number | null,
  ): Promise<void> {
    if (stage === Stage.UNKNOWN) {
      return;
    }

    const streamKey = challengeStageStreamKey(challengeId, stage, attempt);

    const challenge = await this.loadChallenge(challengeId);
    if (challenge === null) {
      await this.client.del(streamKey);
      return;
    }

    const processor = loadChallengeProcessor(
      this.challengeDataRepository,
      this.priceTracker,
      challenge,
    );

    try {
      await this.completeChallengeStage(challenge, processor, stage, attempt);
    } catch (e: unknown) {
      logger.error('challenge_stage_completion_failed', {
        challengeUuid: challengeId,
        stage,
        attempt,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  private async completeChallengeStage(
    challenge: ExtendedChallengeState,
    processor: ChallengeProcessor,
    stage: Stage,
    attempt: number | null,
  ): Promise<void> {
    const stageWithAttempt = stageAndAttempt(stage, attempt);

    await runWithLogContext(
      { challengeUuid: challenge.uuid, stage: stageWithAttempt },
      async () => {
        if (challenge.timeoutState === TimeoutState.STAGE_END) {
          const multi = this.client.multi();
          multi.hSet(
            challengesKey(challenge.uuid),
            'timeoutState',
            TimeoutState.NONE,
          );
          multi.hDel(ChallengeManager.CHALLENGE_TIMEOUT_KEY, challenge.uuid);
          await multi.exec();
        }

        let okToProcess = true;

        await this.watchTransaction(async (client) => {
          // Reset okToProcess in case we had to retry the transaction.
          okToProcess = true;

          const stagesKey = challengeProcessedStagesKey(challenge.uuid);
          await client.watch(stagesKey);
          const multi = client.multi();

          const hasProcessed = await client.sIsMember(
            stagesKey,
            stageWithAttempt,
          );
          if (hasProcessed) {
            okToProcess = false;
          } else {
            multi.sAdd(stagesKey, stageWithAttempt);
            multi.hSet(
              challengesKey(challenge.uuid),
              'processingStage',
              Date.now().toString(),
            );
            return multi.exec();
          }
        });

        if (!okToProcess) {
          logger.debug('stage_already_processed', {
            challengeUuid: challenge.uuid,
            stage: stageWithAttempt,
          });
          return;
        }

        const stageEvents = await this.client.xRange(
          commandOptions({ returnBuffers: true }),
          challengeStageStreamKey(challenge.uuid, stage, attempt),
          '-',
          '+',
        );

        let totalSize = 0;

        const eventsByClient = new Map<number, ClientStageStream[]>();
        for (const evt of stageEvents) {
          try {
            const streamEvent = stageStreamFromRecord(evt.message);
            if (!eventsByClient.has(streamEvent.clientId)) {
              eventsByClient.set(streamEvent.clientId, []);
            }

            eventsByClient.get(streamEvent.clientId)!.push(streamEvent);
            if (streamEvent.type === StageStreamType.STAGE_EVENTS) {
              totalSize += streamEvent.events.length;
            }
          } catch (e: unknown) {
            logger.error('stage_stream_event_parse_failed', {
              challengeUuid: challenge.uuid,
              stage: stageWithAttempt,
              attempt,
              error: e instanceof Error ? e.message : String(e),
            });
          }
        }

        if (eventsByClient.size === 0) {
          const multi = this.client.multi();
          multi.del(challengeStageStreamKey(challenge.uuid, stage, attempt));
          multi.hDel(challengesKey(challenge.uuid), 'processingStage');
          await multi.exec();
          return;
        }

        recordStageEventPayload(stage, totalSize, eventsByClient.size);

        const challengeInfo = {
          uuid: challenge.uuid,
          type: challenge.type,
          party: challenge.party,
        };

        const clients: ClientEvents[] = [];

        for (const [clientId, events] of eventsByClient) {
          const client = ClientEvents.fromClientStream(
            clientId,
            challengeInfo,
            stage,
            events,
          );

          const serverTicks = client.getServerTicks();
          if (serverTicks !== null) {
            recordClientReportedTimePrecision(
              serverTicks.precise ? 'precise' : 'imprecise',
            );
          }

          clients.push(client);
        }

        const result = await timeOperation(
          () => new Merger(stage, clients).merge(),
          (durationMs) => {
            observeMergeDuration(stage, durationMs);
            logger.info('merge_duration', { stage, durationMs });
          },
        );

        const pipeline = this.client.multi();

        if (result !== null) {
          logger.info('stage_finished', {
            challengeUuid: challenge.uuid,
            stage: stageWithAttempt,
            status: result.events.getStatus(),
            ticks: result.events.getLastTick(),
            mergedCount: result.mergedCount,
            unmergedCount: result.unmergedCount,
            skippedCount: result.skippedCount,
          });

          recordStageCompletion(
            stage,
            result.events.getStatus(),
            result.events.isAccurate(),
            result.unmergedCount > 0,
            result.skippedCount > 0,
          );

          this.recordMergeResult(stage, result);

          const updates = await timeOperation(
            async () => await processor.processStage(stage, result.events),
            (durationMs) => {
              logger.info('challenge_stage_processed', {
                challengeUuid: challenge.uuid,
                stage,
                status: result.events.getStatus(),
                durationMs,
              });
              observeStageProcessingDuration(stage, durationMs);
            },
          );
          pipeline.hSet(challengesKey(challenge.uuid), toRedis(updates));

          if (result.unmergedCount > 0) {
            const shouldSave = Math.random() < UNMERGED_EVENT_SAVE_RATE;
            if (shouldSave) {
              setTimeout(() => {
                void runWithLogContext(
                  { challengeUuid: challenge.uuid, stage: stageWithAttempt },
                  () =>
                    this.saveUnmergedEvents(
                      challengeInfo,
                      stage,
                      eventsByClient
                        .values()
                        .flatMap((s) => s)
                        .toArray(),
                      result,
                    ),
                );
              }, 0);
            }
          }
        }

        pipeline.del(challengeStageStreamKey(challenge.uuid, stage, attempt));
        pipeline.hDel(challengesKey(challenge.uuid), 'processingStage');
        await pipeline.exec();
      },
    );
  }

  private async handleStageEndTimeout(uuid: string): Promise<void> {
    const clients = await this.loadChallengeClients(uuid);
    const [stage, attempt] = clients.reduce(
      ([accStage, accAttempt], c) => {
        const { stage: clientStage, attempt: clientAttempt } = c.lastCompleted;
        if (clientStage > accStage) {
          return [clientStage, clientAttempt];
        }

        if (clientStage === accStage) {
          return [accStage, maxAttempt(accAttempt, clientAttempt)];
        }

        return [accStage, accAttempt];
      },
      [Stage.UNKNOWN, null] as [Stage, number | null],
    );
    const uncompletedClients = clients.filter(
      (c) =>
        c.lastCompleted.stage < stage ||
        (c.lastCompleted.stage === stage &&
          (c.lastCompleted.attempt ?? 0) < (attempt ?? 0)),
    );

    logger.debug('stage_end_timeout', {
      challengeUuid: uuid,
      stage,
      attempt,
      uncompletedClients: uncompletedClients.length,
    });
    await this.loadAndCompleteChallengeStage(uuid, stage, attempt);
  }

  /**
   * Cleans up an active challenge. By default, the challenge is only cleaned up
   * if no clients are connected.
   *
   * @param challengeId The ID of the challenge to clean up.
   * @param timeout If set, the challenge's cleanup timeout parameters, which
   *   control whether the cleanup should be retried if clients are still
   *   connected. If null, the challenge is cleaned up immediately.
   */
  private async cleanupChallenge(
    challengeId: string,
    timeout: ChallengeTimeout | null,
    path: FinalizationPath,
  ): Promise<void> {
    const challengeKey = challengesKey(challengeId);
    let status = CleanupStatus.ACTIVE_CLIENTS;

    // Attempt to clear the challenge's active flag if no clients are connected.
    // Once the active flag is unset, we have sole ownership of the challenge
    // data and can clean it up without further coordination.
    await this.watchTransaction(async (client) => {
      await client.watch(challengeKey);
      const multi = client.multi();

      const [[lifecycleState, timeoutState, processingStage], clients] =
        await Promise.all([
          client.hmGet(challengeKey, [
            'state',
            'timeoutState',
            'processingStage',
          ]),
          this.loadChallengeClients(challengeId, client),
        ]);

      if (lifecycleState === null) {
        status = CleanupStatus.CHALLENGE_NOT_FOUND;
        return multi.exec();
      }

      if (
        (Number.parseInt(lifecycleState) as LifecycleState) ===
        LifecycleState.CLEANUP
      ) {
        status = CleanupStatus.CHALLENGE_FAILED_CLEANUP;
        return multi.exec();
      }

      const timeoutStateValue = timeoutState
        ? (Number.parseInt(timeoutState) as TimeoutState)
        : TimeoutState.NONE;
      const processingStartedAt =
        processingStage === null ? null : Number.parseInt(processingStage);
      const now = Date.now();

      if (processingStartedAt !== null) {
        const elapsed = now - processingStartedAt;
        if (elapsed < ChallengeManager.MAX_STAGE_PROCESSING_TIME) {
          status = CleanupStatus.PROCESSING_STAGE;

          if (timeout !== null) {
            // Keep the existing timeout parameters, effectively pausing the
            // challenge from being cleaned up until the stage is processed.
            const nextTimeout: ChallengeTimeout = {
              timestamp: now + timeout.retryIntervalMs,
              maxRetryAttempts: timeout.maxRetryAttempts,
              retryIntervalMs: timeout.retryIntervalMs,
            };
            multi.hSet(
              ChallengeManager.CHALLENGE_TIMEOUT_KEY,
              challengeId,
              JSON.stringify(nextTimeout),
            );
          } else {
            // Create an empty timeout which will immediately clean up the
            // challenge if the stage is not processed within the maximum time.
            const retryTimeout: ChallengeTimeout = {
              timestamp: now + ChallengeManager.STAGE_PROCESSING_RETRY_INTERVAL,
              maxRetryAttempts: 0,
              retryIntervalMs: ChallengeManager.STAGE_PROCESSING_RETRY_INTERVAL,
            };
            multi.hSet(
              ChallengeManager.CHALLENGE_TIMEOUT_KEY,
              challengeId,
              JSON.stringify(retryTimeout),
            );

            if (timeoutStateValue === TimeoutState.NONE) {
              multi.hSet(
                challengeKey,
                'timeoutState',
                TimeoutState.CHALLENGE_END,
              );
            }
          }

          return multi.exec();
        }

        logger.warn('stage_processing_timeout', {
          elapsed,
          maxTime: ChallengeManager.MAX_STAGE_PROCESSING_TIME,
        });
      }

      const requireCleanup = timeout === null || timeout.maxRetryAttempts === 0;

      switch (timeoutStateValue) {
        case TimeoutState.CLEANUP:
        case TimeoutState.CHALLENGE_END:
          // No action needed.
          break;
        default:
          if (timeout !== null) {
            status = CleanupStatus.ACTIVE_CLIENTS;
            return multi.exec();
          }
          break;
      }

      if (requireCleanup || clients.length === 0) {
        status = CleanupStatus.OK;
        multi.hSet(challengeKey, 'state', LifecycleState.CLEANUP);
        multi.hDel(challengeKey, 'processingStage');
      } else {
        status = CleanupStatus.ACTIVE_CLIENTS;
        const nextTimeout: ChallengeTimeout = {
          timestamp: Date.now() + timeout.retryIntervalMs,
          maxRetryAttempts: timeout.maxRetryAttempts - 1,
          retryIntervalMs: timeout.retryIntervalMs,
        };
        multi.hSet(
          ChallengeManager.CHALLENGE_TIMEOUT_KEY,
          challengeId,
          JSON.stringify(nextTimeout),
        );
      }

      await multi.exec();
    });

    switch (status as CleanupStatus) {
      case CleanupStatus.OK:
        recordCleanupAttempt('ok');
        // Proceed.
        break;

      case CleanupStatus.ACTIVE_CLIENTS:
        recordCleanupAttempt('active_clients');
        logger.info('challenge_cleanup_status', {
          challengeUuid: challengeId,
          status: 'active_clients',
        });
        return;

      case CleanupStatus.PROCESSING_STAGE:
        recordCleanupAttempt('processing_stage');
        logger.info('challenge_cleanup_status', {
          challengeUuid: challengeId,
          status: 'processing_stage',
        });
        return;

      case CleanupStatus.CHALLENGE_NOT_FOUND:
        recordCleanupAttempt('challenge_not_found');
        logger.info('challenge_cleanup_status', {
          challengeUuid: challengeId,
          status: 'challenge_not_found',
        });
        // To be safe, clear out any remaining data.
        await this.deleteRedisChallengeData(challengeId);
        return;

      case CleanupStatus.CHALLENGE_FAILED_CLEANUP:
        recordCleanupAttempt('challenge_failed_cleanup');
        logger.warn('challenge_cleanup_status', {
          challengeUuid: challengeId,
          status: 'previously_failed_cleanup',
        });
        await this.deleteRedisChallengeData(challengeId);
        return;
    }

    const challenge = await this.loadChallenge(challengeId);
    const finishTime = new Date();

    const update: ChallengeServerUpdate = {
      id: challengeId,
      action: ChallengeUpdateAction.FINISH,
    };
    await this.client.publish(
      CHALLENGE_UPDATES_PUBSUB_KEY,
      JSON.stringify(update),
    );

    if (challenge !== null) {
      const processor = loadChallengeProcessor(
        this.challengeDataRepository,
        this.priceTracker,
        challenge,
      );

      // Handle any outstanding stage events.
      await this.completeChallengeStage(
        challenge,
        processor,
        challenge.stage,
        challenge.stageAttempt,
      );
      const valid = await processor.finish(finishTime);

      if (
        valid &&
        processor.getChallengeStatus() !== ChallengeStatus.ABANDONED
      ) {
        await this.addActivityFeedItem(ActivityFeedItemType.CHALLENGE_END, {
          challengeId,
        });
      }

      logger.info('challenge_completed', {
        challengeUuid: challengeId,
        status: processor.getChallengeStatus(),
      });

      recordChallengeFinalization(path, processor.getChallengeStatus());

      await this.deleteRedisChallengeData(
        challengeId,
        challenge.type,
        challenge.party,
      );
    } else {
      await this.deleteRedisChallengeData(challengeId);
    }
  }

  /**
   * Clears all Redis data associated with a challenge.
   * @param challenge The challenge to clean up.
   */
  private async deleteRedisChallengeData(
    id: string,
    type?: ChallengeType,
    party?: string[],
  ): Promise<void> {
    await this.watchTransaction(async (client) => {
      const multi = client.multi();
      multi.del(challengesKey(id));
      multi.del(challengeClientsKey(id));
      multi.del(challengeProcessedStagesKey(id));
      multi.hDel(ChallengeManager.CHALLENGE_TIMEOUT_KEY, id);

      const streamsSetKey = challengeStreamsSetKey(id);
      await client.watch(streamsSetKey);
      const streams = await client.sMembers(streamsSetKey);
      for (const stream of streams) {
        multi.del(stream);
      }
      multi.del(streamsSetKey);

      if (type !== undefined && party !== undefined) {
        multi.lRem(partyKeyChallengeList(type, party), 1, id);
      }

      if (party !== undefined) {
        const currentChallenges = await Promise.all(
          party.map(async (player) => {
            const key = activePlayerKey(player);
            await client.watch(key);
            return await client.get(key);
          }),
        );

        party.forEach((player, i) => {
          if (currentChallenges[i] === id) {
            multi.del(activePlayerKey(player));
          }
        });
      }

      return await multi.exec();
    });
  }

  /**
   * Fetches the state of a challenge from Redis.
   * @param challengeId ID of the challenge.
   * @param client Optional Redis client to use for the operation. Defaults to
   *   the store's primary client.
   * @returns Current state of the challenge, or null if the challenge does not
   *   exist.
   */
  private async loadChallenge(
    challengeId: string,
    client?: RedisClientType,
  ): Promise<ExtendedChallengeState | null> {
    const c = client ?? this.client;
    const state = await c.hGetAll(challengesKey(challengeId));
    if (Object.keys(state).length === 0) {
      return null;
    }
    return fromRedis(state as RedisChallengeState);
  }

  /**
   * Returns all of the clients connected to a challenge.
   * @param challengeId ID of the challenge.
   * @param client Optional Redis client to use for the operation. Defaults to
   *   the store's primary client.
   * @returns List of connected clients.
   */
  private async loadChallengeClients(
    challengeId: string,
    client?: RedisClientType,
  ): Promise<ChallengeClient[]> {
    const c = client ?? this.client;
    const clients = await c.hGetAll(challengeClientsKey(challengeId));
    return Object.values(clients).map(
      (client) => JSON.parse(client) as ChallengeClient,
    );
  }

  private async checkForActiveClients(challengeId: string): Promise<void> {
    await this.watchTransaction(async (client) => {
      await client.watch(challengeClientsKey(challengeId));
      await client.watch(challengesKey(challengeId));
      await client.watch(ChallengeManager.CHALLENGE_TIMEOUT_KEY);

      const multi = client.multi();
      const clients = await this.loadChallengeClients(challengeId, client);

      const hasTimeout = await client.hExists(
        ChallengeManager.CHALLENGE_TIMEOUT_KEY,
        challengeId,
      );
      if (hasTimeout) {
        return multi.exec();
      }

      const activeClients = clients.filter((c) => c.active);
      if (activeClients.length === 0) {
        logger.info('challenge_reconnection_timer_started', {
          challengeUuid: challengeId,
          timeout: ChallengeManager.MAX_RECONNECTION_PERIOD,
        });
        recordReconnectionTimer('all_inactive');
        const timeout: ChallengeTimeout = {
          timestamp: Date.now() + ChallengeManager.MAX_RECONNECTION_PERIOD,
          maxRetryAttempts: 3,
          retryIntervalMs: ChallengeManager.MAX_RECONNECTION_PERIOD,
        };
        multi.hSet(
          challengesKey(challengeId),
          'timeoutState',
          TimeoutState.CLEANUP,
        );
        multi.hSet(
          ChallengeManager.CHALLENGE_TIMEOUT_KEY,
          challengeId,
          JSON.stringify(timeout),
        );
      }

      return multi.exec();
    });
  }

  private async processOneChallengeTimeout(): Promise<void> {
    while (true) {
      let challenges: Record<string, string>;
      try {
        challenges = await this.client.hGetAll(
          ChallengeManager.CHALLENGE_TIMEOUT_KEY,
        );
      } catch (e) {
        logger.error('redis_error', {
          key: ChallengeManager.CHALLENGE_TIMEOUT_KEY,
          error: e instanceof Error ? e.message : String(e),
        });
        break;
      }

      const now = Date.now();
      let timedOutChallenge: string | null = null;
      let timeoutInfo: ChallengeTimeout | null = null;

      for (const challengeId in challenges) {
        const timeout = JSON.parse(challenges[challengeId]) as ChallengeTimeout;
        if (timeout.timestamp <= now) {
          timedOutChallenge = challengeId;
          timeoutInfo = timeout;
          break;
        }
      }

      if (timedOutChallenge !== null) {
        const state = await this.client
          .hGet(challengesKey(timedOutChallenge), 'timeoutState')
          .then((s) =>
            s === null || s === undefined
              ? null
              : (Number.parseInt(s) as TimeoutState),
          );

        if (state === TimeoutState.CLEANUP) {
          recordTimeoutEvent('cleanup');
          logger.info('challenge_cleanup_started', {
            challengeUuid: timedOutChallenge,
            status: 'expired',
          });
          await this.cleanupChallenge(
            timedOutChallenge,
            timeoutInfo,
            'timeout',
          );
        } else if (state === TimeoutState.CHALLENGE_END) {
          recordTimeoutEvent('challenge_end');
          logger.info('challenge_cleanup_started', {
            challengeUuid: timedOutChallenge,
            status: 'finished',
          });
          await this.cleanupChallenge(timedOutChallenge, timeoutInfo, 'normal');
        } else if (state === TimeoutState.STAGE_END) {
          recordTimeoutEvent('stage_end');
          await this.handleStageEndTimeout(timedOutChallenge);
          await this.checkForActiveClients(timedOutChallenge);
        } else {
          recordTimeoutEvent('none');
          if (state !== TimeoutState.NONE) {
            logger.warn('challenge_cleanup_invalid_state', {
              challengeUuid: timedOutChallenge,
              state,
            });
          }
          await this.client.hDel(
            ChallengeManager.CHALLENGE_TIMEOUT_KEY,
            timedOutChallenge,
          );
          // Try to find another timed-out challenge.
          continue;
        }
      }

      break;
    }
  }

  private async processChallengeTimeouts() {
    this.timeoutTaskTimer = null;

    try {
      await this.processOneChallengeTimeout();
    } catch (e: unknown) {
      logger.error('challenge_timeout_processing_failed', {
        error: e instanceof Error ? e.message : String(e),
      });
    }

    if (this.manageTimeouts) {
      this.timeoutTaskTimer = setTimeout(() => {
        void this.processChallengeTimeouts();
      }, ChallengeManager.CHALLENGE_TIMEOUT_INTERVAL);
    }
  }

  private async addActivityFeedItem(
    type: ActivityFeedItemType,
    data: ActivityFeedData,
  ): Promise<void> {
    await this.client.xAdd(
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
  }

  /**
   * Attempts to execute a Redis multi transaction which watches keys for
   * concurrent modifications. Retries until the transaction completes
   * successfully.
   * @param txn The transaction function. Invoked with an isolated Redis client.
   */
  private async watchTransaction<T>(
    txn: (client: RedisClientType) => Promise<T | undefined>,
    action: string = 'generic',
  ): Promise<void> {
    let attempt = 0;

    while (true) {
      attempt++;
      try {
        await this.client.executeIsolated(txn);
        break;
      } catch (e) {
        if (e instanceof WatchError) {
          // Retry the transaction.
          logger.debug('watch_transaction_retry', { attempt, action });
          recordWatchConflict(action);
        } else {
          throw e;
        }
      }
    }
  }

  private recordMergeResult(stage: Stage, result: MergeResult): void {
    for (const client of result.clients) {
      recordMergeClient(client.classification, client.status);
      for (const anomaly of client.anomalies) {
        recordClientAnomaly(stage, anomaly);
      }
    }
    for (const alert of result.alerts) {
      recordMergeAlert(stage, alert.type);
    }

    // TODO(frolv): Persist merge result in the data repository.
  }

  private async saveUnmergedEvents(
    challenge: ChallengeInfo,
    stage: Stage,
    events: ClientStageStream[],
    result: MergeResult,
  ): Promise<void> {
    // Save all event data as a single JSON file. This is inefficient as the
    // files are quite large, but it's simple to work with and debug. Ideally,
    // the amount of merge failures should reduce over time, making this less
    // of a concern :)
    const stageEventData: UnmergedEventData = {
      challengeInfo: challenge,
      stage,
      mergedClients: result.clients.filter(
        (client) => client.status === MergeClientStatus.MERGED,
      ),
      unmergedClients: result.clients.filter(
        (client) => client.status === MergeClientStatus.UNMERGED,
      ),
      rawEvents: events,
    };

    try {
      await this.testDataRepository.saveRaw(
        unmergedEventsFile(challenge.uuid, stage),
        Buffer.from(JSON.stringify(stageEventData)),
      );
      recordRepositoryWrite('test', 'unmerged_events', 'success');
      logger.info('unmerged_events_saved', {
        challengeUuid: challenge.uuid,
        stage,
        mergedCount: result.mergedCount,
        unmergedCount: result.unmergedCount,
        skippedCount: result.skippedCount,
      });
    } catch (e) {
      recordRepositoryWrite('test', 'unmerged_events', 'error');
      logger.error('unmerged_events_save_error', {
        challengeUuid: challenge.uuid,
        stage,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
}

export type UnmergedEventData = {
  challengeInfo: ChallengeInfo;
  stage: Stage;
  mergedClients: MergeClient[];
  unmergedClients: MergeClient[];
  rawEvents: ClientStageStream[];
};

const UNMERGED_EVENT_SAVE_RATE = 0.1;
const UNMERGED_EVENTS_DIR = 'unmerged-events';
export function unmergedEventsFile(challengeId: string, stage: Stage): string {
  return `${UNMERGED_EVENTS_DIR}/${challengeId}:${stage}_events.json`;
}

type ChallengeTimeout = {
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

class SessionWatchdog {
  private static readonly WATCHDOG_INTERVAL_MS = 5 * 60 * 1000;

  private client: RedisClientType;
  private running;
  private log: Logger;

  public constructor(client: RedisClientType) {
    this.client = client;
    this.running = false;
    this.log = logger.child({ service: 'session-watchdog' });
  }

  public async run(): Promise<void> {
    this.client.on('error', (err) => {
      this.log.error('redis_error', {
        error: err instanceof Error ? err : new Error(String(err)),
      });
    });

    await this.client.connect();
    this.running = true;

    this.log.info('watchdog_started');

    while (this.running) {
      try {
        await this.finishInactiveSessions();
      } catch (e) {
        this.log.error('session_watchdog_error', {
          error: e instanceof Error ? e.message : String(e),
        });
        recordSessionWatchdogRun('error');
      }

      await delay(SessionWatchdog.WATCHDOG_INTERVAL_MS);
    }

    this.log.info('watchdog_exited');
  }

  public stop(): void {
    this.running = false;
  }

  private async finishInactiveSessions(): Promise<void> {
    const expiringSessions = await ChallengeProcessor.loadExpiringSessions();
    let expiredSessions = 0;

    for (const session of expiringSessions) {
      const sk = sessionKey(session.challengeType, session.partyHash);

      // There are two ways a session could expire: if its Redis key has
      // expired, or if the same party has started a new session, in which case
      // the ID will not match.
      const id = await this.client.get(sk);
      const hasExpired = id === null || Number.parseInt(id) !== session.id;

      if (!hasExpired) {
        continue;
      }

      this.log.debug('session_expired', { sessionId: session.id });
      ++expiredSessions;
      await ChallengeProcessor.finalizeSession(session.id);
    }

    this.log.info('watchdog_finish_inactive_sessions', {
      candidates: expiringSessions.length,
      expired: expiredSessions,
    });

    if (expiredSessions > 0) {
      recordSessionWatchdogRun('expired_sessions');
    } else {
      recordSessionWatchdogRun('no_expired_sessions');
    }
  }
}
