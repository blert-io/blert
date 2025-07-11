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
  SessionStatus,
} from '@blert/common';
import { RedisClientType, WatchError, commandOptions } from 'redis';
import { v4 as uuidv4 } from 'uuid';

import { ClientEvents, ServerTicks } from './client-events';
import {
  ChallengeProcessor,
  ChallengeState,
  ReportedTimes,
  loadChallengeProcessor,
  newChallengeProcessor,
} from './event-processing';
import logger from './log';
import { ChallengeInfo, MergeResult, Merger } from './merge';
import { Logger } from 'winston';

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

const DEFERRED_JOIN_MAX_RETRIES = 10;
const DEFERRED_JOIN_RETRY_INTERVAL_MS = 10;

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
  processingStage: boolean;
};

type RedisChallengeState = Record<keyof ExtendedChallengeState, string>;

/** A client connected to an active challenge. */
type ChallengeClient = {
  userId: number;
  type: RecordingType;
  active: boolean;
  stage: Stage;
  stageStatus: StageStatus;
  lastCompletedStage: Stage;
};

function toRedis(
  state: Partial<ExtendedChallengeState>,
): Partial<RedisChallengeState> {
  let result: Partial<RedisChallengeState> = {};

  for (const key in state) {
    const k = key as keyof ChallengeState;
    const value = state[k];
    if (value === null) {
      continue;
    }

    if (k === 'players') {
      result[k] = JSON.stringify(value);
    } else if (Array.isArray(value)) {
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
    status: Number.parseInt(state.status) as ChallengeStatus,
    stageStatus: Number.parseInt(state.stageStatus) as StageStatus,
    party: state.party.split(','),
    players: JSON.parse(state.players),
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
    processingStage: state.processingStage === '1',
    customData: state.customData ? JSON.parse(state.customData) : null,
  };
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
      this.timeoutTaskTimer = setTimeout(
        () => this.processChallengeTimeouts(),
        ChallengeManager.CHALLENGE_TIMEOUT_INTERVAL,
      );
      this.sessionWatchdog.run();
    } else {
      this.timeoutTaskTimer = null;
    }

    setTimeout(() => this.processEvents(), 100);
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
  ): Promise<string> {
    if (mode === ChallengeMode.TOB_ENTRY) {
      throw new ChallengeError(
        ChallengeErrorType.UNSUPPORTED,
        'ToB entry mode challenges are not supported',
      );
    }

    const partyMembers = party.join(',');
    const partyKeyList = partyKeyChallengeList(type, party);
    const sk = sessionKey(type, party);

    let startAction = StartAction.UNKNOWN;
    let challengeUuid: string = '';
    let sessionId: number | null = null;

    const challengeClient: ChallengeClient = {
      userId,
      type: recordingType,
      active: true,
      stage,
      stageStatus: StageStatus.ENTERED,
      lastCompletedStage: Stage.UNKNOWN,
    };

    // Requests from multiple clients in the same party may arrive around the
    // same time, so we need to ensure that only one challenge is created for
    // the party.
    await this.watchTransaction(async (client) => {
      // Reset state in case we had to retry the transaction.
      startAction = StartAction.UNKNOWN;
      challengeUuid = '';

      await Promise.all([client.watch(partyKeyList), client.watch(sk)]);
      const multi = client.multi();

      const lastChallengeForParty = await client.lIndex(partyKeyList, -1);
      if (lastChallengeForParty !== null) {
        const key = challengesKey(lastChallengeForParty);
        await client.watch(key);

        const [stateValue, statusValue, stageValue, timeoutStateValue] =
          await client.hmGet(key, ['state', 'status', 'stage', 'timeoutState']);

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
          logger.warn(
            `User ${userId}: Challenge ${lastChallengeForParty} no longer ` +
              'exists, cleaning up',
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
            logger.info(
              `User ${userId}: Previous challenge for party ${partyMembers} ` +
                'has completed; starting new one',
            );
            startAction = StartAction.CREATE;
          } else if (stage !== Stage.UNKNOWN && stage < lastStage) {
            logger.info(
              `User ${userId}: Request to start challenge for party ` +
                `${partyMembers} at stage ${stage} is earlier than the ` +
                `previous stage ${lastStage}; assuming a new challenge`,
            );
            startAction = StartAction.CREATE;
          } else if (lifecycleState === LifecycleState.INITIALIZING) {
            logger.info(
              `User ${userId}: Request to start challenge for party ` +
                `${partyMembers} is initializing; deferring join`,
            );
            startAction = StartAction.DEFERRED_JOIN;
          } else {
            logger.info(
              `User ${userId}: Joining existing challenge for ${partyMembers}`,
            );

            challengeUuid = lastChallengeForParty;
            startAction = StartAction.IMMEDIATE_JOIN;

            multi.set(clientChallengesKey(userId), lastChallengeForParty);
            multi.hSet(
              challengeClientsKey(challengeUuid),
              userId,
              JSON.stringify(challengeClient),
            );

            // Refresh the session duration.
            multi.expire(sk, SESSION_ACTIVITY_DURATION_S, 'GT');
          }
        }
      } else {
        logger.info(
          `User ${userId}: Starting new challenge for ${partyMembers}`,
        );
        startAction = StartAction.CREATE;
      }

      if (startAction === StartAction.CREATE) {
        // Generate a UUID for the new challenge and set the minimum required
        // fields for other clients to recognize the challenge is initializing.
        challengeUuid = uuidv4();
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

        const sessionIdValue = await client.get(sk);
        if (sessionIdValue !== null) {
          sessionId = Number.parseInt(sessionIdValue);
        }
      } else {
        // If a client is joining a challenge that is due for cleanup, reset
        // its timeout state to allow the challenge to continue.
        const timeoutState = await client.hGet(
          challengesKey(challengeUuid),
          'timeoutState',
        );
        if (
          timeoutState !== undefined &&
          parseInt(timeoutState) === TimeoutState.CLEANUP
        ) {
          multi.hSet(
            challengesKey(challengeUuid),
            'timeoutState',
            TimeoutState.NONE,
          );
        }
      }

      return multi.exec();
    });

    if (startAction === StartAction.UNKNOWN || challengeUuid === '') {
      // This should never happen as the transaction should always set these
      // values, but log some basic debugging information just in case.
      logger.error(
        'Failed to start challenge for user %d: type=%d, stage=%d, party=%s',
        userId,
        type,
        stage,
        party.join(','),
      );
      throw new Error('Failed to start challenge');
    }

    switch (startAction) {
      case StartAction.CREATE: {
        // This client is responsible for creating the challenge in the
        // database. Once that is done, activate the challenge and update its
        // Redis state from its challenge processor.

        const startTime = new Date();
        let processor: ChallengeProcessor;

        try {
          processor = newChallengeProcessor(
            this.challengeDataRepository,
            this.priceTracker,
            challengeUuid,
            type,
            mode,
            stage,
            StageStatus.ENTERED,
            party,
          );

          await processor.createNew(startTime, sessionId);
        } catch (e) {
          logger.error(
            `User ${userId}: Failed to create challenge ${challengeUuid}`,
            e,
          );

          await this.deleteRedisChallengeData(challengeUuid, type, party);

          if (e instanceof ChallengeError) {
            throw e;
          }
          throw new ChallengeError(
            ChallengeErrorType.INTERNAL,
            'Failed to create challenge',
          );
        }

        await this.watchTransaction(async (client) => {
          await client.watch(sk);

          const multi = client
            .multi()
            .hSet(challengesKey(challengeUuid), {
              ...toRedis(processor.getState()),
              state: LifecycleState.ACTIVE,
            })
            .hSet(
              challengeClientsKey(challengeUuid),
              userId,
              JSON.stringify(challengeClient),
            )
            .set(clientChallengesKey(userId), challengeUuid)
            .set(sk, processor.getSessionId(), {
              EX: SESSION_ACTIVITY_DURATION_S,
            });

          for (const player of party) {
            multi.set(activePlayerKey(player), challengeUuid);
          }

          return multi.exec();
        });

        logger.info(
          `User ${userId}: Created challenge ${challengeUuid} ` +
            `in session ${processor.getSessionId()} at stage ${stage}`,
        );
        break;
      }

      case StartAction.DEFERRED_JOIN: {
        // Another client is simultaneously creating the challenge. Wait until
        // it is ready, then have this client join it.
        const key = challengesKey(challengeUuid);
        let retries = 0;

        while (retries < DEFERRED_JOIN_MAX_RETRIES) {
          let complete = false;

          await this.watchTransaction(async (client) => {
            await client.watch(key);

            const multi = client.multi();

            const state = await client.hGet(key, 'state');
            const lifecycleState =
              state !== undefined
                ? (Number.parseInt(state) as LifecycleState)
                : null;

            if (
              lifecycleState === null ||
              lifecycleState === LifecycleState.CLEANUP
            ) {
              logger.error(
                `User ${userId}: Challenge ${challengeUuid} was deleted with ` +
                  'a pending deferred join',
              );
              throw new ChallengeError(
                ChallengeErrorType.INTERNAL,
                `Challenge ${challengeUuid} no longer exists`,
              );
            }

            if (lifecycleState === LifecycleState.ACTIVE) {
              complete = true;

              multi.set(clientChallengesKey(userId), challengeUuid);
              multi.hSet(
                challengeClientsKey(challengeUuid),
                userId,
                JSON.stringify(challengeClient),
              );
            }

            return multi.exec();
          });

          if (complete) {
            break;
          }

          const delayMs = DEFERRED_JOIN_RETRY_INTERVAL_MS * (retries + 1);
          await delay(Math.min(delayMs, 50));
          retries++;
        }

        if (retries === DEFERRED_JOIN_MAX_RETRIES) {
          throw new ChallengeError(
            ChallengeErrorType.INTERNAL,
            `Failed to join challenge ${challengeUuid} for user ${userId}`,
          );
        }

        logger.info(
          `User ${userId}: Deferred-joined ${challengeUuid} in ${retries} attempts`,
        );
        break;
      }

      case StartAction.IMMEDIATE_JOIN: {
        // No additional action is required here as the client was already
        // added in the initial transaction.
        break;
      }
    }

    await ChallengeProcessor.addRecorder(challengeUuid, userId, recordingType);
    return challengeUuid;
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
      logger.warn(
        `User ${userId} attempted to finish challenge ${challengeId} ` +
          `but is currently in challenge ${currentChallenge}`,
      );
      return;
    }

    logger.info(`User ${userId} finishing challenge ${challengeId}`);
    const challengeKey = challengesKey(challengeId);

    let allClientsFinished = false;

    await this.watchTransaction(async (client) => {
      // Reset allClientsFinished in case we had to retry the transaction.
      allClientsFinished = false;

      await client.watch(challengeKey);
      await client.watch(challengeClientsKey(challengeId));
      const multi = client.multi();

      multi.del(clientChallengesKey(userId));

      const challenge = await this.loadChallenge(challengeId, client);
      if (challenge === null || challenge.state !== LifecycleState.ACTIVE) {
        logger.warn(`Challenge ${challengeId} is no longer active`);
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
        logger.warn(
          `User ${userId} attempted to finish challenge ${challengeId} ` +
            'but is not in the challenge',
        );
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
          multi.hSet(challengeKey, 'timeoutState', TimeoutState.CHALLENGE_END);
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

      // TODO(frolv): Collect and cross-check reported times from all clients.
      if (reportedTimes !== null) {
        multi.hSet(
          challengeKey,
          'reportedChallengeTicks',
          reportedTimes.challenge,
        );
        multi.hSet(challengeKey, 'reportedOverallTicks', reportedTimes.overall);
      }

      return multi.exec();
    });
  }

  public async update(
    challengeId: string,
    userId: number,
    update: ChallengeUpdate,
  ): Promise<boolean> {
    const currentChallenge = await this.client.get(clientChallengesKey(userId));
    if (currentChallenge !== challengeId) {
      if (currentChallenge === null) {
        logger.warn(
          `User ${userId} attempted to update challenge ${challengeId} ` +
            'but is not currently in a challenge',
        );
      } else {
        logger.warn(
          `User ${userId} attempted to update challenge ${challengeId} ` +
            `but is currently in challenge ${currentChallenge}`,
        );
      }
      return false;
    }

    let updated = true;
    let forceCleanup = false;
    let finishStage: Stage | null = null;

    await this.watchTransaction(async (client) => {
      // Reset state variables in case we had to retry the transaction.
      updated = true;
      forceCleanup = false;
      finishStage = null;

      await client.watch(challengesKey(challengeId));
      const challenge = await this.loadChallenge(challengeId, client);
      const multi = client.multi();

      if (challenge === null) {
        logger.warn(
          `Player ${userId} attempted to update non-existent challenge`,
        );
        updated = false;
        return multi.exec();
      }

      if (challenge.timeoutState === TimeoutState.CLEANUP) {
        multi.hSet(
          challengesKey(challengeId),
          'timeoutState',
          TimeoutState.NONE,
        );
        logger.debug(
          `${challengeId}: canceling cleanup due to client activity`,
        );
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
          logger.info(`Ending ToB entry mode challenge ${challengeId}`);
          forceCleanup = true;
          return multi.exec();
        }

        processor.setMode(update.mode);
      }

      if (update.stage !== undefined) {
        const stageUpdate = update.stage;
        if (stageUpdate.stage < challenge.stage) {
          logger.warn(
            `User ${userId} attempted to update challenge ${challengeId} ` +
              `to stage ${stageUpdate.stage}, but it is at later stage ` +
              `${challenge.stage}`,
          );
          updated = false;
          return multi.exec();
        }

        await client.watch(challengeClientsKey(challengeId));
        const clients = await this.loadChallengeClients(challengeId, client);

        const us = clients.find((c) => c.userId === userId);
        if (us === undefined) {
          logger.warn(
            `User ${userId} attempted to update challenge ${challengeId} ` +
              'but is not currently in the challenge',
          );
          updated = false;
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
          us.lastCompletedStage = stageUpdate.stage;

          const numFinishedClients = clients.reduce(
            (acc, c) =>
              c.stage > challenge.stage || isFinished(c.stageStatus)
                ? acc + 1
                : acc,
            0,
          );

          logger.debug(
            `${challengeId}: client ${userId} finished stage ${stageUpdate.stage} ` +
              `[${numFinishedClients}/${clients.length}]`,
          );

          if (numFinishedClients === clients.length) {
            finishStage = stageUpdate.stage;
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
          processor.setStage(stageUpdate.stage);
        }

        multi.hSet(
          challengeClientsKey(challengeId),
          userId,
          JSON.stringify(us),
        );
      }

      const updates = await processor.finalizeUpdates();
      if (Object.keys(updates).length > 0) {
        multi.hSet(challengesKey(challengeId), toRedis(updates));
      }

      return multi.exec();
    });

    if (forceCleanup) {
      await this.cleanupChallenge(challengeId, null);
    } else if (finishStage !== null) {
      setTimeout(
        () => this.loadAndCompleteChallengeStage(challengeId, finishStage!),
        0,
      );
    }

    return updated;
  }

  /**
   * Adds a client to an existing challenge.
   * @param challengeId ID of the challenge to join.
   * @param userId ID of the client.
   * @param recordingType Type of client recording.
   * @throws ChallengeError if the join fails.
   */
  public async addClient(
    challengeId: string,
    userId: number,
    recordingType: RecordingType,
  ): Promise<void> {
    const currentChallenge = await this.client.get(clientChallengesKey(userId));
    if (currentChallenge !== null) {
      logger.warn(
        `User ${userId} attempted to join challenge ${challengeId} ` +
          `but is already in challenge ${currentChallenge}`,
      );
      throw new ChallengeError(
        ChallengeErrorType.FAILED_PRECONDITION,
        'User is already in a challenge',
      );
    }

    await this.watchTransaction(async (client) => {
      await Promise.all([
        client.watch(challengesKey(challengeId)),
        client.watch(challengeClientsKey(challengeId)),
      ]);
      const multi = client.multi();

      const [challenge, clients] = await Promise.all([
        this.loadChallenge(challengeId, client),
        this.loadChallengeClients(challengeId, client),
      ]);

      if (challenge === null || challenge.state !== LifecycleState.ACTIVE) {
        logger.warn(
          `User ${userId} attempted to join non-existent challenge ${challengeId}`,
        );
        return multi.exec();
      }

      const clientInfo: ChallengeClient = {
        userId,
        type: recordingType,
        active: true,
        stage: challenge.stage,
        stageStatus: StageStatus.ENTERED,
        lastCompletedStage: Stage.UNKNOWN,
      };
      multi.hSet(
        challengeClientsKey(challengeId),
        userId,
        JSON.stringify(clientInfo),
      );

      const allInactive = clients.every((c) => !c.active);
      if (allInactive && challenge.timeoutState === TimeoutState.CLEANUP) {
        logger.debug(
          `User ${userId} reconnected to inactive challenge ${challengeId}`,
        );
        // Pause any pending cleanup if the challenge was previously inactive.
        multi.hSet(
          challengesKey(challengeId),
          'timeoutState',
          TimeoutState.NONE,
        );
        multi.hDel(ChallengeManager.CHALLENGE_TIMEOUT_KEY, challengeId);
      }

      multi.set(clientChallengesKey(userId), challengeId);

      return multi.exec();
    });
  }

  private async processEvents() {
    this.eventClient.on('error', (err) => {
      logger.error(`Event queue error: ${err}`);
    });
    await this.eventClient.connect();

    while (this.eventQueueActive) {
      const res = await this.eventClient.blPop(CLIENT_EVENTS_KEY, 60);
      if (res === null) {
        // Hit the timeout; simply try again.
        continue;
      }

      const event = JSON.parse(res.element) as ClientEvent;

      const clientChallenge = await this.eventClient.get(
        clientChallengesKey(event.userId),
      );
      if (clientChallenge === null) {
        continue;
      }

      if (event.type === ClientEventType.STATUS) {
        const statusEvent = event as ClientStatusEvent;
        switch (statusEvent.status) {
          case ClientStatus.ACTIVE:
            await this.setClientActive(event.userId, clientChallenge);
            break;
          case ClientStatus.IDLE:
            await this.setClientInactive(event.userId, clientChallenge);
            break;
          case ClientStatus.DISCONNECTED:
            await this.removeClient(event.userId, clientChallenge);
            break;
        }
      }
    }

    this.eventClient.disconnect();
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
        logger.debug(
          `Cannot remove client ${id} from challenge ${challengeId} as it no longer exists`,
        );
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

        logger.info(
          `Challenge ${challengeId} has no clients; starting reconnection timer`,
        );
      }

      return multi.exec();
    });
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
        logger.warn(
          `setClientActive: client ${id} not in challenge ${challengeId}`,
        );
        multi.del(clientChallengesKey(id));
        return multi.exec();
      }

      if (us.active) {
        return multi.exec();
      }

      logger.debug(`${challengeId}: client ${id} reconnected`);
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
        logger.warn(
          `setClientInactive: client ${id} not in challenge ${challengeId}`,
        );
        multi.del(clientChallengesKey(id));
        return multi.exec();
      }

      if (!us.active) {
        return multi.exec();
      }

      logger.debug(`${challengeId}: client ${id} disconnected`);
      us.active = false;
      multi.hSet(clientsKey, id, JSON.stringify(us));

      const allInactive = clients.every((c) => !c.active);
      if (allInactive && challenge.timeoutState === TimeoutState.NONE) {
        logger.info(
          `${challengeId}: all clients inactive; starting reconnection timer`,
        );
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
  ): Promise<void> {
    if (stage === Stage.UNKNOWN) {
      return;
    }

    const streamKey = challengeStageStreamKey(challengeId, stage);

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
      this.completeChallengeStage(challenge, processor, stage);
    } catch (e) {
      logger.error(
        `Error completing stage ${stage} for challenge ${challengeId}: ${e}`,
      );
    }
  }

  private async completeChallengeStage(
    challenge: ExtendedChallengeState,
    processor: ChallengeProcessor,
    stage: Stage,
  ): Promise<void> {
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

      const hasProcessed = await client.sIsMember(stagesKey, stage.toString());
      if (hasProcessed) {
        okToProcess = false;
      } else {
        multi.sAdd(stagesKey, stage.toString());
        multi.hSet(challengesKey(challenge.uuid), 'processingStage', '1');
        return multi.exec();
      }
    });

    if (!okToProcess) {
      logger.debug(
        `${challenge.uuid}: stage ${stage} already processed; skipping`,
      );
      return;
    }

    const stageEvents = await this.client
      .xRange(
        commandOptions({ returnBuffers: true }),
        challengeStageStreamKey(challenge.uuid, stage),
        '-',
        '+',
      )
      .then((res) => res.map((s) => stageStreamFromRecord(s.message)));

    if (stageEvents.length === 0) {
      const multi = this.client.multi();
      multi.del(challengeStageStreamKey(challenge.uuid, stage));
      multi.hSet(challengesKey(challenge.uuid), 'processingStage', '0');
      await multi.exec();
      return;
    }

    const eventsByClient = new Map<number, ClientStageStream[]>();
    for (const evt of stageEvents) {
      if (!eventsByClient.has(evt.clientId)) {
        eventsByClient.set(evt.clientId, []);
      }
      eventsByClient.get(evt.clientId)!.push(evt);
    }

    const challengeInfo = {
      uuid: challenge.uuid,
      type: challenge.type,
      party: challenge.party,
    };

    const clients: ClientEvents[] = [];

    for (const [clientId, events] of eventsByClient) {
      clients.push(
        ClientEvents.fromClientStream(clientId, challengeInfo, stage, events),
      );
    }

    const merger = new Merger(stage, clients);
    const result = merger.merge();

    const multi = this.client.multi();

    if (result !== null) {
      logger.info(
        '%s: stage %d finished with status %s in %d ticks; %d clients merged, %d unmerged',
        challenge.uuid,
        stage,
        result.events.getStatus(),
        result.events.getLastTick(),
        result.mergedClients.length,
        result.unmergedClients.length,
      );

      const updates = await processor.processStage(stage, result.events);
      multi.hSet(challengesKey(challenge.uuid), toRedis(updates));

      if (result.unmergedClients.length > 0) {
        const shouldSave = Math.random() < UNMERGED_EVENT_SAVE_RATE;
        if (shouldSave) {
          setTimeout(
            () =>
              this.saveUnmergedEvents(
                challengeInfo,
                stage,
                stageEvents,
                result,
              ),
            0,
          );
        }
      }
    }

    multi.del(challengeStageStreamKey(challenge.uuid, stage));
    multi.hSet(challengesKey(challenge.uuid), 'processingStage', '0');
    await multi.exec();
  }

  private async handleStageEndTimeout(uuid: string): Promise<void> {
    const clients = await this.loadChallengeClients(uuid);
    const stage = clients.reduce(
      (acc, c) => Math.max(acc, c.lastCompletedStage),
      Stage.UNKNOWN,
    );
    const uncompletedClients = clients.filter(
      (c) => c.lastCompletedStage < stage,
    );

    logger.debug(
      `Forcing stage ${stage} end for challenge ${uuid} ` +
        `after timeout (${uncompletedClients.length} uncompleted clients)`,
    );
    await this.loadAndCompleteChallengeStage(uuid, stage);
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
  ): Promise<void> {
    const challengeKey = challengesKey(challengeId);
    let okToCleanup = false;

    // Attempt to clear the challenge's active flag if no clients are connected.
    // Once the active flag is unset, we have sole ownership of the challenge
    // data and can clean it up without further coordination.
    await this.watchTransaction(async (client) => {
      await client.watch(challengeKey);
      const multi = client.multi();

      // Reset okToCleanup in case we had to retry the transaction.
      okToCleanup = false;

      const [[lifecycleState, timeoutState, processingStage], clients] =
        await Promise.all([
          client.hmGet(challengeKey, [
            'state',
            'timeoutState',
            'processingStage',
          ]),
          this.loadChallengeClients(challengeId, client),
        ]);
      if (
        lifecycleState === null ||
        Number.parseInt(lifecycleState) === LifecycleState.CLEANUP
      ) {
        logger.debug(`Challenge ${challengeId} no longer exists`);
        return multi.exec();
      }

      let requireCleanup = timeout === null || timeout.maxRetryAttempts === 0;

      switch (Number.parseInt(timeoutState)) {
        case TimeoutState.CLEANUP:
          break;
        case TimeoutState.CHALLENGE_END:
          if (processingStage === '1' && timeout !== null) {
            logger.info(
              `Challenge ${challengeId} still processing stage; delaying finish`,
            );
            requireCleanup = false;
          }
          break;
        default:
          if (timeout !== null) {
            logger.debug(
              `Challenge ${challengeId} still active; canceling cleanup`,
            );
            return multi.exec();
          }
          break;
      }

      if (requireCleanup || clients.length === 0) {
        multi.hSet(challengeKey, 'state', LifecycleState.CLEANUP);
        multi.hSet(challengeKey, 'processingStage', 0);
        okToCleanup = true;
      } else {
        const nextTimeout: ChallengeTimeout = {
          timestamp: Date.now() + timeout!.retryIntervalMs,
          maxRetryAttempts: timeout!.maxRetryAttempts - 1,
          retryIntervalMs: timeout!.retryIntervalMs,
        };
        multi.hSet(
          ChallengeManager.CHALLENGE_TIMEOUT_KEY,
          challengeId,
          JSON.stringify(nextTimeout),
        );
      }

      await multi.exec();
    });

    if (!okToCleanup) {
      logger.info(
        `Challenge ${challengeId} still has connected clients; aborting`,
      );
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
      await this.completeChallengeStage(challenge, processor, challenge.stage);
      const valid = await processor.finish(finishTime);

      if (
        valid &&
        processor.getChallengeStatus() !== ChallengeStatus.ABANDONED
      ) {
        await this.addActivityFeedItem(ActivityFeedItemType.CHALLENGE_END, {
          challengeId,
        });
      }

      logger.info(`Challenge ${challengeId} completed`);

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
        logger.info(
          `${challengeId} has no active clients; starting reconnection timer`,
        );
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
        logger.error(`Failed to fetch challenge timeouts: ${e}`);
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
          logger.info(`Cleaning up expired challenge ${timedOutChallenge}`);
          await this.cleanupChallenge(timedOutChallenge, timeoutInfo);
        } else if (state === TimeoutState.CHALLENGE_END) {
          logger.info(`Finishing challenge ${timedOutChallenge} after timeout`);
          await this.cleanupChallenge(timedOutChallenge, null);
        } else if (state === TimeoutState.STAGE_END) {
          await this.handleStageEndTimeout(timedOutChallenge);
          await this.checkForActiveClients(timedOutChallenge);
        } else {
          if (state !== TimeoutState.NONE) {
            logger.warn(
              `Timed-out challenge ${timedOutChallenge} has unknown timeout state ` +
                `${state}; ignoring`,
            );
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
    } catch (e) {
      logger.error(`Error processing challenge timeout: ${e}`);
    }

    if (this.manageTimeouts) {
      this.timeoutTaskTimer = setTimeout(
        () => this.processChallengeTimeouts(),
        ChallengeManager.CHALLENGE_TIMEOUT_INTERVAL,
      );
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
  ): Promise<void> {
    while (true) {
      try {
        await this.client.executeIsolated(txn);
        break;
      } catch (e) {
        if (e instanceof WatchError) {
          // Retry the transaction.
          logger.debug('Retrying transaction due to watch error');
        } else {
          throw e;
        }
      }
    }
  }

  private async saveUnmergedEvents(
    challenge: ChallengeInfo,
    stage: Stage,
    events: ClientStageStream[],
    result: MergeResult,
  ): Promise<void> {
    logger.info(
      `Merge failure: saving all client events for unmerged stage ${stage} of ${challenge.uuid}`,
    );

    // Save all event data as a single JSON file. This is inefficient as the
    // files are quite large, but it's simple to work with and debug. Ideally,
    // the amount of merge failures should reduce over time, making this less
    // of a concern :)
    const stageEventData: UnmergedEventData = {
      challengeInfo: challenge,
      stage,
      mergedClients: result.mergedClients.map((c) => ({
        id: c.getId(),
        ticks: c.getFinalTick(),
        serverTicks: c.getServerTicks(),
        accurate: c.isAccurate(),
        spectator: c.isSpectator(),
      })),
      unmergedClients: result.unmergedClients.map((c) => ({
        id: c.getId(),
        ticks: c.getFinalTick(),
        serverTicks: c.getServerTicks(),
        accurate: c.isAccurate(),
        spectator: c.isSpectator(),
      })),
      rawEvents: events,
    };

    await this.testDataRepository.saveRaw(
      unmergedEventsFile(challenge.uuid, stage),
      Buffer.from(JSON.stringify(stageEventData)),
    );
  }
}

type ClientMetadata = {
  id: number;
  ticks: number;
  serverTicks: ServerTicks | null;
  accurate: boolean;
  spectator: boolean;
};

export type UnmergedEventData = {
  challengeInfo: ChallengeInfo;
  stage: Stage;
  mergedClients: ClientMetadata[];
  unmergedClients: ClientMetadata[];
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
      this.log.error(`Redis error: ${err}`);
    });

    await this.client.connect();
    this.running = true;

    this.log.info(`Watchdog started`);

    while (this.running) {
      await this.finishInactiveSessions();
      await delay(SessionWatchdog.WATCHDOG_INTERVAL_MS);
    }

    this.log.info(`Watchdog exited`);
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

      this.log.debug(`Session ${session.id} has expired; finishing`);
      ++expiredSessions;
      await ChallengeProcessor.finalizeSession(session.id);
    }

    this.log.info(
      `Watchdog finishInactiveSessions: candidates=%d, expired=%d`,
      expiringSessions.length,
      expiredSessions,
    );
  }
}
