import {
  ActivityFeedItemType,
  ChallengeMode,
  ChallengeStatus,
  ChallengeType,
  ChallengeUpdateAction,
  ClientEventType,
  ClientStageStream,
  ClientStatus,
  ClientStatusEvent,
  DataRepository,
  PriceTracker,
  RecordingType,
  Stage,
  StageStatus,
  sessionKey,
  StageStreamType,
} from '@blert/common';
import { RedisClientType } from 'redis';
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
  setClientEventQueueDepth,
  type ChallengeRequestAction,
  type ChallengeRequestDecision,
  type ClientEventStatusLabel,
  type FinalizationPath,
} from './metrics';
import {
  ChallengeClient,
  ChallengeTimeout,
  EventQueueClient,
  LifecycleState,
  RedisClient,
  TimeoutState,
} from './redis-client';
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

type ExtendedChallengeState = ChallengeState & {
  state: LifecycleState;
  timeoutState: TimeoutState;
  /** Timestamp at which stage processing began. */
  processingStage: number | null;
};

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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default class ChallengeManager {
  private challengeDataRepository: DataRepository;
  private testDataRepository: DataRepository;
  private priceTracker: PriceTracker;
  private redisClient: RedisClient;
  private eventClient: EventQueueClient;
  private eventQueueActive: boolean;

  private manageTimeouts: boolean;
  private timeoutTaskTimer: NodeJS.Timeout | null;
  private sessionWatchdog: SessionWatchdog;

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
    this.redisClient = new RedisClient(client);
    this.eventClient = new EventQueueClient(client.duplicate());
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
      void this.processClientEvents();
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

      let statusResponse: ChallengeStatusResponse | null = null;

      const decision = await this.determineStartAction(
        userId,
        type,
        recordingType,
        stage,
        party,
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
  ): Promise<StartActionDecision> {
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

    // Requests from multiple clients in the same party may arrive around the
    // same time, so we need to ensure that only one challenge is created for
    // the party.
    const decision = await this.redisClient.transaction(async (txn) => {
      let startAction = StartAction.UNKNOWN;
      let startDecision: StartActionDecision | null = null;

      const lastChallengeForParty = await txn.getLastChallengeForParty(
        type,
        party,
      );
      if (lastChallengeForParty !== null) {
        const {
          state: lifecycleState,
          mode = ChallengeMode.NO_MODE,
          status,
          stage: lastStage,
          stageAttempt = null,
          timeoutState = TimeoutState.NONE,
        } = await txn.getChallengeFields(lastChallengeForParty, [
          'state',
          'mode',
          'status',
          'stage',
          'stageAttempt',
          'timeoutState',
        ]);

        if (
          lifecycleState === undefined ||
          lifecycleState === LifecycleState.CLEANUP ||
          status === undefined ||
          lastStage === undefined
        ) {
          logChallengeJoinDecision(
            StartAction.CREATE,
            'challenge_not_found',
            { lastChallengeForParty },
            'warn',
          );
          txn.deleteLastChallengeForParty(type, party);
          startAction = StartAction.CREATE;
        } else {
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
            startDecision = {
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
            startDecision = {
              action: StartAction.IMMEDIATE_JOIN,
              uuid: lastChallengeForParty,
              response: {
                uuid: lastChallengeForParty,
                mode,
                stage: lastStage,
                stageAttempt,
              },
            };

            const challengeClient = createChallengeClient(
              userId,
              recordingType,
              startDecision.response.stage,
              startDecision.response.stageAttempt,
            );
            txn.setChallengeClient(
              lastChallengeForParty,
              userId,
              challengeClient,
            );

            txn.refreshSessionDuration(type, party);
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
        txn.addChallengeForParty(type, party, challengeUuid);
        txn.setChallengeFields(challengeUuid, {
          state: LifecycleState.INITIALIZING,
          status: ChallengeStatus.IN_PROGRESS,
          stage,
          timeoutState: TimeoutState.NONE,
        });

        const sessionId = await txn.getSessionId(type, party);
        startDecision = {
          action: StartAction.CREATE,
          uuid: challengeUuid,
          sessionId,
        };
      } else if (startDecision !== null) {
        // If a client is joining a challenge that is due for cleanup, reset
        // its timeout state to allow the challenge to continue.
        const { timeoutState } = await txn.getChallengeFields(
          startDecision.uuid,
          ['timeoutState'],
        );
        if (timeoutState === TimeoutState.CLEANUP) {
          txn.clearChallengeTimeout(startDecision.uuid);
        }
      }

      return startDecision;
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
  ): Promise<ChallengeStatusResponse> {
    // This client is responsible for creating the challenge in the database.
    // Once that is done, activate the challenge and update its Redis state from
    // its challenge processor.
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

      await this.redisClient.deleteChallengeData(uuid, type, party);

      if (e instanceof ChallengeError) {
        throw e;
      }
      throw new ChallengeError(
        ChallengeErrorType.INTERNAL,
        'Failed to create challenge',
      );
    }

    const challengeClient = createChallengeClient(userId, recordingType, stage);

    await this.redisClient.pipeline((pipeline) => {
      pipeline.setChallengeFields(uuid, {
        ...processor.getState(),
        state: LifecycleState.ACTIVE,
      });
      pipeline.setChallengeClient(uuid, userId, challengeClient);
      pipeline.setSessionChallenge(processor.getSessionId(), type, party);

      for (const player of party) {
        pipeline.setPlayerActiveChallenge(player, uuid);
      }
    });

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
    let retries = 0;

    let statusResponse: ChallengeStatusResponse | null = null;

    while (retries < DEFERRED_JOIN_MAX_RETRIES) {
      const complete = await this.redisClient.transaction(async (txn) => {
        const {
          state: lifecycleState,
          mode,
          stage,
          stageAttempt = null,
        } = await txn.getChallengeFields(uuid, [
          'state',
          'mode',
          'stage',
          'stageAttempt',
        ]);

        if (
          lifecycleState === undefined ||
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

        if (lifecycleState !== LifecycleState.ACTIVE) {
          return false;
        }

        statusResponse = {
          uuid,
          mode: mode ?? ChallengeMode.NO_MODE,
          stage: stage ?? Stage.UNKNOWN,
          stageAttempt,
        };

        const challengeClient = createChallengeClient(
          userId,
          recordingType,
          statusResponse.stage,
          statusResponse.stageAttempt,
        );

        txn.setChallengeClient(uuid, userId, challengeClient);
        return true;
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
    const { success, allClientsFinished, result, ...context } =
      await this.redisClient.transaction(async (txn) => {
        const currentChallenge = await txn.getActiveChallengeForClient(userId);
        if (currentChallenge !== challengeId) {
          return {
            success: false,
            allClientsFinished: false,
            result: 'not_in_challenge',
            context: { currentChallenge },
          };
        }

        txn.removeChallengeClient(challengeId, userId);

        const challenge = await txn.getChallenge(challengeId);
        if (challenge === null || challenge.state !== LifecycleState.ACTIVE) {
          return {
            success: false,
            allClientsFinished: false,
            result: 'challenge_not_active',
          };
        }

        // As there is activity, refresh the challenge's session duration.
        txn.refreshSessionDuration(challenge.type, challenge.party);

        const clients = await txn.getChallengeClients(challengeId);
        const self = clients.find((c) => c.userId === userId);
        if (self === undefined) {
          return {
            success: false,
            allClientsFinished: false,
            result: 'not_in_challenge',
          };
        }

        let timeoutState: TimeoutState;
        let timeout: ChallengeTimeout;

        const allClientsFinished = clients.length === 1;
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
            timeoutState = TimeoutState.CHALLENGE_END;
          } else {
            timeout = {
              timestamp: Date.now() + ChallengeManager.MAX_RECONNECTION_PERIOD,
              maxRetryAttempts: 1,
              retryIntervalMs: ChallengeManager.MAX_RECONNECTION_PERIOD,
            };
            timeoutState = TimeoutState.CLEANUP;
          }
        } else {
          timeout = {
            timestamp: Date.now() + 1500,
            maxRetryAttempts: 3,
            retryIntervalMs: 1000,
          };
          timeoutState = TimeoutState.CHALLENGE_END;
        }

        txn.setChallengeTimeout(challengeId, timeoutState, timeout);

        if (reportedTimes !== null) {
          txn.setChallengeFields(challengeId, {
            reportedChallengeTicks: reportedTimes.challenge,
            reportedOverallTicks: reportedTimes.overall,
          });
        }

        return {
          success: true,
          allClientsFinished,
          result: 'success',
        };
      });

    logger.info('challenge_finish', {
      userId,
      challengeUuid: challengeId,
      result,
      allClientsFinished,
      ...context,
    });

    if (success) {
      recordFinishRequest(allClientsFinished, 'accepted');
    } else if (result !== null) {
      recordFinishRequest(allClientsFinished, 'rejected');
    }
  }

  public async update(
    challengeId: string,
    userId: number,
    update: ChallengeUpdate,
  ): Promise<ChallengeStatusResponse | null> {
    const currentChallenge =
      await this.redisClient.getActiveChallengeForClient(userId);
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

    await this.redisClient.transaction(async (txn) => {
      // Reset state variables in case we had to retry the transaction.
      result = null;
      forceCleanup = false;
      finishStage = null;
      stageStarted = null;

      const challenge = await txn.getChallenge(challengeId);
      if (challenge === null) {
        logger.warn('challenge_update_rejected', {
          userId,
          challengeUuid: challengeId,
          reason: 'non_existent',
        });
        result = null;
        return;
      }

      if (challenge.timeoutState === TimeoutState.CLEANUP) {
        txn.clearChallengeTimeout(challengeId);
        logger.debug('challenge_cleanup_canceled', {
          challengeUuid: challengeId,
          reason: 'client_activity',
        });
      }

      // As there is activity, refresh the challenge's session duration.
      txn.refreshSessionDuration(challenge.type, challenge.party);

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
          return;
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
          return;
        }

        const clients = await txn.getChallengeClients(challengeId);
        const us = clients.find((c) => c.userId === userId);
        if (us === undefined) {
          logger.warn('challenge_update_rejected', {
            userId,
            challengeUuid: challengeId,
            reason: 'not_in_challenge',
          });
          result = null;
          return;
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
              txn.clearChallengeTimeout(challengeId);
            }
          } else if (challenge.timeoutState !== TimeoutState.STAGE_END) {
            txn.setChallengeTimeout(challengeId, TimeoutState.STAGE_END, {
              timestamp: Date.now() + ChallengeManager.STAGE_END_TIMEOUT,
              maxRetryAttempts: 0,
              retryIntervalMs: 0,
            });
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

        txn.setChallengeClient(challengeId, userId, us);
      }

      const updates = await processor.finalizeUpdates();
      result = {
        uuid: challengeId,
        mode: challenge.mode,
        stage: challenge.stage,
        stageAttempt: challenge.stageAttempt,
      };

      if (Object.keys(updates).length > 0) {
        txn.setChallengeFields(challengeId, updates);
        result = { ...result, ...updates };
      }
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
      await this.redisClient.pipeline((pipeline) => {
        pipeline.setChallengeFields(challengeId, {
          processingStage: Date.now(),
        });
      });
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
      const currentChallenge =
        await this.redisClient.getActiveChallengeForClient(userId);
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

      await this.redisClient.transaction(async (txn) => {
        statusResponse = null;

        const [challenge, clients] = await Promise.all([
          txn.getChallenge(challengeId),
          txn.getChallengeClients(challengeId),
        ]);

        if (challenge === null || challenge.state !== LifecycleState.ACTIVE) {
          logger.warn('challenge_join_rejected', {
            userId,
            challengeUuid: challengeId,
            reason: 'non_existent',
          });
          metricDecision = 'rejected';
          return;
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

        txn.setChallengeClient(challengeId, userId, clientInfo);

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
          txn.clearChallengeTimeout(challengeId);
        }

        statusResponse = {
          uuid: challengeId,
          mode: challenge.mode,
          stage: clientInfo.stage,
          stageAttempt: clientInfo.stageAttempt,
        };
      });

      if (statusResponse === null) {
        metricDecision = 'rejected';
        throw new ChallengeError(
          ChallengeErrorType.FAILED_PRECONDITION,
          'Challenge does not exist',
        );
      }

      const response = statusResponse as ChallengeStatusResponse;

      logger.info('client_reconnected', {
        userId,
        challengeUuid: challengeId,
        stage: response.stage,
        attempt: response.stageAttempt,
      });
      metricDecision = 'accepted';

      return response;
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

  private async removeClient(id: number, challengeId: string): Promise<void> {
    await this.redisClient.transaction(async (txn) => {
      txn.removeChallengeClient(challengeId, id);

      const [{ state: lifecycleState }, clients] = await Promise.all([
        txn.getChallengeFields(challengeId, ['state']),
        txn.getChallengeClients(challengeId),
      ]);

      if (
        lifecycleState === undefined ||
        lifecycleState === LifecycleState.CLEANUP
      ) {
        logger.warn('client_remove_rejected', {
          userId: id,
          challengeUuid: challengeId,
          reason: 'non_existent',
        });
        return;
      }

      if (clients.length <= 1) {
        txn.setChallengeTimeout(challengeId, TimeoutState.CLEANUP, {
          timestamp: Date.now() + ChallengeManager.MAX_RECONNECTION_PERIOD,
          maxRetryAttempts: 3,
          retryIntervalMs: ChallengeManager.MAX_RECONNECTION_PERIOD,
        });

        logger.info('challenge_reconnection_timer_started', {
          challengeUuid: challengeId,
          timeout: ChallengeManager.MAX_RECONNECTION_PERIOD,
        });
        recordReconnectionTimer('disconnect');
      }
    });
  }

  private async updateClientEventQueueDepth(): Promise<void> {
    try {
      const length = await this.eventClient.getQueueDepth();
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
    await this.redisClient.transaction(async (txn) => {
      const [activeChallenge, challenge, us] = await Promise.all([
        txn.getActiveChallengeForClient(id),
        txn.getChallenge(challengeId),
        txn.getChallengeClient(challengeId, id),
      ]);

      if (activeChallenge !== challengeId || challenge === null) {
        txn.removeChallengeClient(challengeId, id);
        return;
      }

      if (us === null) {
        logger.warn('client_not_in_challenge', {
          userId: id,
          challengeUuid: challengeId,
          operation: 'set_client_active',
        });
        txn.removeChallengeClient(challengeId, id);
        return;
      }

      if (us.active) {
        return;
      }

      logger.debug('client_reconnected', {
        challengeId,
        userId: id,
      });
      us.active = true;

      txn.setChallengeClient(challengeId, id, us);

      // A client has reconnected, so cancel any pending cleanup.
      if (challenge.timeoutState === TimeoutState.CLEANUP) {
        txn.clearChallengeTimeout(challengeId);
      }
    });
  }

  private async setClientInactive(
    id: number,
    challengeId: string,
  ): Promise<void> {
    await this.redisClient.transaction(async (txn) => {
      const [activeChallenge, challenge, clients] = await Promise.all([
        txn.getActiveChallengeForClient(id),
        txn.getChallenge(challengeId),
        txn.getChallengeClients(challengeId),
      ]);

      if (activeChallenge !== challengeId || challenge === null) {
        txn.removeChallengeClient(challengeId, id);
        return;
      }

      const us = clients.find((c) => c.userId === id);
      if (us === undefined) {
        logger.warn('client_not_in_challenge', {
          userId: id,
          challengeUuid: challengeId,
          operation: 'set_client_inactive',
        });
        txn.removeChallengeClient(challengeId, id);
        return;
      }

      if (!us.active) {
        return;
      }

      logger.debug('client_disconnected', {
        challengeUuid: challengeId,
        userId: id,
      });
      us.active = false;
      txn.setChallengeClient(challengeId, id, us);

      const allInactive = clients.every((c) => !c.active);
      if (allInactive && challenge.timeoutState === TimeoutState.NONE) {
        logger.info('challenge_reconnection_timer_started', {
          challengeUuid: challengeId,
          timeout: ChallengeManager.MAX_INACTIVITY_PERIOD,
        });
        recordReconnectionTimer('all_inactive');
        txn.setChallengeTimeout(challengeId, TimeoutState.CLEANUP, {
          timestamp: Date.now() + ChallengeManager.MAX_INACTIVITY_PERIOD,
          maxRetryAttempts: 0,
          retryIntervalMs: ChallengeManager.MAX_INACTIVITY_PERIOD,
        });
      }
    });
  }

  private async processClientEvents(): Promise<void> {
    this.eventClient.onError((err) => {
      logger.error('client_event_queue_error', {
        error: err instanceof Error ? err : new Error(String(err)),
      });
    });
    await this.eventClient.connect();

    while (this.eventQueueActive) {
      // Set a timeout per pop as some production Redis servers don't like long
      // blocking operations. If the timeout is reached, simply try again.
      const event = await this.eventClient.popEvent(60_000);
      if (event === null) {
        continue;
      }

      await this.updateClientEventQueueDepth();

      const clientChallenge =
        await this.redisClient.getActiveChallengeForClient(event.userId);
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

  private async loadAndCompleteChallengeStage(
    challengeId: string,
    stage: Stage,
    attempt: number | null,
  ): Promise<void> {
    if (stage === Stage.UNKNOWN) {
      return;
    }

    const challenge = await this.redisClient.getChallenge(challengeId);
    if (challenge === null) {
      await this.redisClient.pipeline((pipeline) => {
        pipeline.deleteStageStream(challengeId, stage, attempt);
      });
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
    await runWithLogContext(
      { challengeUuid: challenge.uuid, stage, attempt },
      async () => {
        if (challenge.timeoutState === TimeoutState.STAGE_END) {
          await this.redisClient.pipeline((pipeline) => {
            pipeline.clearChallengeTimeout(challenge.uuid);
          });
        }

        const okToProcess = await this.redisClient.transaction(async (txn) => {
          const hasProcessed = await txn.hasProcessedStage(
            challenge.uuid,
            stage,
            attempt,
          );
          if (hasProcessed) {
            return false;
          }

          txn.setProcessedStage(challenge.uuid, stage, attempt);
          txn.setChallengeFields(challenge.uuid, {
            processingStage: Date.now(),
          });
          return true;
        });

        if (!okToProcess) {
          logger.debug('stage_already_processed', {
            challengeUuid: challenge.uuid,
            stage,
            attempt,
          });
          return;
        }

        const stageEvents = await this.redisClient.getStageStream(
          challenge.uuid,
          stage,
          attempt,
        );
        let totalSize = 0;

        const eventsByClient = new Map<number, ClientStageStream[]>();
        for (const evt of stageEvents) {
          if (!eventsByClient.has(evt.clientId)) {
            eventsByClient.set(evt.clientId, []);
          }
          eventsByClient.get(evt.clientId)!.push(evt);
          if (evt.type === StageStreamType.STAGE_EVENTS) {
            totalSize += evt.events.length;
          }
        }

        if (eventsByClient.size === 0) {
          await this.redisClient.pipeline((pipeline) => {
            pipeline.deleteStageStream(challenge.uuid, stage, attempt);
            pipeline.setChallengeFields(challenge.uuid, {
              processingStage: null,
            });
          });
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

        if (result !== null) {
          logger.info('stage_finished', {
            challengeUuid: challenge.uuid,
            stage,
            attempt,
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

          await this.redisClient.pipeline((pipeline) => {
            pipeline.setChallengeFields(challenge.uuid, {
              ...updates,
              processingStage: null,
            });
            pipeline.deleteStageStream(challenge.uuid, stage, attempt);
          });

          if (result.unmergedCount > 0) {
            const shouldSave = Math.random() < UNMERGED_EVENT_SAVE_RATE;
            if (shouldSave) {
              setTimeout(() => {
                void runWithLogContext(
                  { challengeUuid: challenge.uuid, stage, attempt },
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
      },
    );
  }

  private async handleStageEndTimeout(uuid: string): Promise<void> {
    const clients = await this.redisClient.getChallengeClients(uuid);
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
    let status = CleanupStatus.ACTIVE_CLIENTS as CleanupStatus;

    // Attempt to clear the challenge's active flag if no clients are connected.
    // Once the active flag is unset, we have sole ownership of the challenge
    // data and can clean it up without further coordination.
    await this.redisClient.transaction(async (txn) => {
      const [
        {
          state: lifecycleState,
          timeoutState = TimeoutState.NONE,
          processingStage: processingStartedAt = null,
        },
        clients,
      ] = await Promise.all([
        txn.getChallengeFields(challengeId, [
          'state',
          'timeoutState',
          'processingStage',
        ]),
        txn.getChallengeClients(challengeId),
      ]);

      if (lifecycleState === undefined) {
        status = CleanupStatus.CHALLENGE_NOT_FOUND;
        return;
      }

      if (lifecycleState === LifecycleState.CLEANUP) {
        status = CleanupStatus.CHALLENGE_FAILED_CLEANUP;
        return;
      }

      const now = Date.now();

      if (processingStartedAt !== null) {
        const elapsed = now - processingStartedAt;
        if (elapsed < ChallengeManager.MAX_STAGE_PROCESSING_TIME) {
          status = CleanupStatus.PROCESSING_STAGE;

          if (timeout !== null) {
            // Keep the existing timeout parameters, effectively pausing the
            // challenge from being cleaned up until the stage is processed.
            txn.setChallengeTimeout(challengeId, timeoutState, {
              ...timeout,
              timestamp: now + timeout.retryIntervalMs,
            });
          } else {
            // Create an empty timeout which will immediately clean up the
            // challenge if the stage is not processed within the maximum time.
            const newTimeoutState =
              timeoutState === TimeoutState.NONE
                ? TimeoutState.CHALLENGE_END
                : timeoutState;
            txn.setChallengeTimeout(challengeId, newTimeoutState, {
              timestamp: now + ChallengeManager.STAGE_PROCESSING_RETRY_INTERVAL,
              maxRetryAttempts: 0,
              retryIntervalMs: ChallengeManager.STAGE_PROCESSING_RETRY_INTERVAL,
            });
          }

          return;
        }

        logger.warn('stage_processing_timeout', {
          elapsed,
          maxTime: ChallengeManager.MAX_STAGE_PROCESSING_TIME,
        });
      }

      const requireCleanup = timeout === null || timeout.maxRetryAttempts === 0;

      switch (timeoutState) {
        case TimeoutState.CLEANUP:
        case TimeoutState.CHALLENGE_END:
          // No action needed.
          break;
        default:
          if (timeout !== null) {
            status = CleanupStatus.ACTIVE_CLIENTS;
            return;
          }
          break;
      }

      if (requireCleanup || clients.length === 0) {
        status = CleanupStatus.OK;
        txn.setChallengeFields(challengeId, {
          state: LifecycleState.CLEANUP,
          processingStage: null,
        });
      } else {
        status = CleanupStatus.ACTIVE_CLIENTS;
        txn.setChallengeTimeout(challengeId, timeoutState, {
          timestamp: Date.now() + timeout.retryIntervalMs,
          maxRetryAttempts: timeout.maxRetryAttempts - 1,
          retryIntervalMs: timeout.retryIntervalMs,
        });
      }
    });

    switch (status) {
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
        await this.redisClient.deleteChallengeData(challengeId);
        return;

      case CleanupStatus.CHALLENGE_FAILED_CLEANUP:
        recordCleanupAttempt('challenge_failed_cleanup');
        logger.warn('challenge_cleanup_status', {
          challengeUuid: challengeId,
          status: 'previously_failed_cleanup',
        });
        await this.redisClient.deleteChallengeData(challengeId);
        return;
    }

    const challenge = await this.redisClient.getChallenge(challengeId);
    const finishTime = new Date();

    await this.redisClient.pipeline((pipeline) => {
      pipeline.publishChallengeUpdate({
        id: challengeId,
        action: ChallengeUpdateAction.FINISH,
      });
    });

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
        await this.redisClient.pipeline((txn) => {
          txn.addActivityFeedItem(ActivityFeedItemType.CHALLENGE_END, {
            challengeId,
          });
        });
      }

      logger.info('challenge_completed', {
        challengeUuid: challengeId,
        status: processor.getChallengeStatus(),
      });

      recordChallengeFinalization(path, processor.getChallengeStatus());

      await this.redisClient.deleteChallengeData(
        challengeId,
        challenge.type,
        challenge.party,
      );
    } else {
      await this.redisClient.deleteChallengeData(challengeId);
    }
  }

  private async checkForActiveClients(challengeId: string): Promise<void> {
    await this.redisClient.transaction(async (txn) => {
      const [{ timeoutState = TimeoutState.NONE }, clients, timeout] =
        await Promise.all([
          txn.getChallengeFields(challengeId, ['timeoutState']),
          txn.getChallengeClients(challengeId),
          txn.getChallengeTimeout(challengeId),
        ]);

      const hasTimeout = timeout !== null && timeoutState !== TimeoutState.NONE;
      if (hasTimeout) {
        return;
      }

      const activeClients = clients.filter((c) => c.active);
      if (activeClients.length === 0) {
        logger.info('challenge_reconnection_timer_started', {
          challengeUuid: challengeId,
          timeout: ChallengeManager.MAX_RECONNECTION_PERIOD,
        });
        recordReconnectionTimer('all_inactive');
        txn.setChallengeTimeout(challengeId, TimeoutState.CLEANUP, {
          timestamp: Date.now() + ChallengeManager.MAX_RECONNECTION_PERIOD,
          maxRetryAttempts: 3,
          retryIntervalMs: ChallengeManager.MAX_RECONNECTION_PERIOD,
        });
      }
    });
  }

  private async processOneChallengeTimeout(): Promise<void> {
    while (true) {
      const timeouts = await this.redisClient.getChallengeTimeouts();

      const now = Date.now();
      let timedOutChallenge: string | null = null;
      for (const [challengeId, timeout] of timeouts) {
        if (timeout.timestamp <= now) {
          timedOutChallenge = challengeId;
          break;
        }
      }

      if (timedOutChallenge !== null) {
        const { timeoutState } = await this.redisClient.getChallengeFields(
          timedOutChallenge,
          ['timeoutState'],
        );
        const timeoutInfo = timeouts.get(timedOutChallenge)!;

        if (timeoutState === TimeoutState.CLEANUP) {
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
        } else if (timeoutState === TimeoutState.CHALLENGE_END) {
          recordTimeoutEvent('challenge_end');
          logger.info('challenge_cleanup_started', {
            challengeUuid: timedOutChallenge,
            status: 'finished',
          });
          await this.cleanupChallenge(timedOutChallenge, timeoutInfo, 'normal');
        } else if (timeoutState === TimeoutState.STAGE_END) {
          recordTimeoutEvent('stage_end');
          await this.handleStageEndTimeout(timedOutChallenge);
          await this.checkForActiveClients(timedOutChallenge);
        } else {
          recordTimeoutEvent('none');
          if (timeoutState !== TimeoutState.NONE) {
            logger.warn('challenge_cleanup_invalid_state', {
              challengeUuid: timedOutChallenge,
              timeoutState,
            });
          }
          await this.redisClient.pipeline((txn) => {
            txn.clearChallengeTimeout(timedOutChallenge);
          });
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
