import {
  CHALLENGE_UPDATES_PUBSUB_KEY,
  ChallengeMode,
  ChallengeStatus,
  ChallengeType,
  ChallengeServerUpdate,
  ChallengeUpdateAction,
  CLIENT_EVENTS_KEY,
  ClientEvent,
  ClientEventType,
  ClientStageStream,
  ClientStatusEvent,
  ClientStatus,
  DataRepository,
  PriceTracker,
  RecordingType,
  Stage,
  StageStatus,
  challengeStageStreamKey,
  challengesKey,
  clientChallengesKey,
  partyKeyChallengeList,
  stageStreamFromRecord,
} from '@blert/common';
import { RedisClientType, WatchError, commandOptions } from 'redis';
import { v4 as uuidv4 } from 'uuid';

import { ClientEvents } from './client-events';
import {
  ChallengeProcessor,
  ChallengeState,
  ReportedTimes,
  loadChallengeProcessor,
  newChallengeProcessor,
} from './event-processing';
import logger from './log';
import { Merger } from './merge';

export const enum ChallengeErrorType {
  UNSUPPORTED,
}

export class ChallengeError extends Error {
  public readonly type: ChallengeErrorType;

  public constructor(type: ChallengeErrorType, message: string) {
    super(message);
    this.type = type;
  }
}

enum TimeoutState {
  NONE = 0,
  STAGE_END = 1,
  CLEANUP = 2,
}

type ExtendedChallengeState = ChallengeState & {
  active: boolean;
  connectedClients: number;
  activeClients: number;
  timeoutState: TimeoutState;
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

function toRedis(state: ExtendedChallengeState): Partial<RedisChallengeState> {
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
    } else {
      result[k] = value.toString();
    }
  }

  return result;
}

function fromRedis(state: RedisChallengeState): ExtendedChallengeState {
  return {
    id: Number.parseInt(state.id),
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
    active: state.active === '1',
    reportedChallengeTicks: state.reportedChallengeTicks
      ? Number.parseInt(state.reportedChallengeTicks)
      : null,
    reportedOverallTicks: state.reportedOverallTicks
      ? Number.parseInt(state.reportedOverallTicks)
      : null,
    connectedClients: Number.parseInt(state.connectedClients),
    activeClients: Number.parseInt(state.activeClients),
    timeoutState: Number.parseInt(state.timeoutState) as TimeoutState,
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

export default class ChallengeStore {
  private challengeDataRepository: DataRepository;
  private priceTracker: PriceTracker;
  private client: RedisClientType;
  private eventClient: RedisClientType;
  private eventQueueActive: boolean;

  private manageTimeouts: boolean;
  private timeoutTaskTimer: NodeJS.Timeout | null;

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
  private static readonly STAGE_END_TIMEOUT = 1500;

  public constructor(
    challengeDataRepository: DataRepository,
    client: RedisClientType,
    manageTimeouts: boolean,
  ) {
    this.challengeDataRepository = challengeDataRepository;
    this.priceTracker = new PriceTracker();
    this.client = client;
    this.eventClient = client.duplicate();
    this.eventQueueActive = true;

    this.manageTimeouts = manageTimeouts;
    if (this.manageTimeouts) {
      this.timeoutTaskTimer = setTimeout(
        () => this.processChallengeTimeouts(),
        ChallengeStore.CHALLENGE_TIMEOUT_INTERVAL,
      );
    } else {
      this.timeoutTaskTimer = null;
    }

    setTimeout(() => this.processEvents(), 100);
  }

  public async getOrCreate(
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

    let processor: ChallengeProcessor | null = null;

    // Requests from multiple clients in the same party may arrive around the
    // same time, so we need to ensure that only one challenge is created for
    // the party.
    await this.watchTransaction(async (client) => {
      await client.watch(partyKeyList);
      const multi = client.multi();

      let challengeId = '';
      let createNewChallenge = false;

      const lastChallengeForParty = await client.lIndex(partyKeyList, -1);
      if (lastChallengeForParty !== null) {
        const key = challengesKey(lastChallengeForParty);
        await client.watch(key);

        const [active, statusValue, stageValue] = await client.hmGet(key, [
          'active',
          'status',
          'stage',
        ]);

        if (active !== '1' || statusValue === null || stageValue === null) {
          logger.warn(
            `Challenge ${lastChallengeForParty} no longer exists, cleaning up`,
          );
          multi.rPop(partyKeyList);
          createNewChallenge = true;
        } else {
          const status = Number.parseInt(statusValue) as ChallengeStatus;
          const lastStage = Number.parseInt(stageValue) as Stage;

          if (status !== ChallengeStatus.IN_PROGRESS) {
            logger.info(
              `Previous challenge for party ${partyMembers} ` +
                'has completed; starting new one',
            );
            createNewChallenge = true;
          } else if (stage < lastStage) {
            logger.info(
              `Request to start challenge for party ${partyMembers} ` +
                `at stage ${stage} is earlier than the previous stage ` +
                `${lastStage}; assuming a new challenge`,
            );
            createNewChallenge = true;
          } else {
            logger.info(
              `User ${userId} joining existing challenge for ${partyMembers}`,
            );

            multi.hIncrBy(key, 'connectedClients', 1);
            multi.hIncrBy(key, 'activeClients', 1);
            multi.set(clientChallengesKey(userId), lastChallengeForParty);

            challengeId = lastChallengeForParty;
          }
        }
      } else {
        logger.info(
          `User ${userId} starting new challenge for ${partyMembers}`,
        );
        createNewChallenge = true;
      }

      if (createNewChallenge) {
        challengeId = uuidv4();
        const startTime = new Date();

        multi.rPush(partyKeyList, challengeId);
        multi.set(clientChallengesKey(userId), challengeId);

        processor = newChallengeProcessor(
          this.challengeDataRepository,
          this.priceTracker,
          challengeId,
          type,
          mode,
          stage,
          StageStatus.ENTERED,
          party,
        );

        await processor.createNew(startTime);

        multi.hSet(
          challengesKey(challengeId),
          toRedis({
            ...processor.getState(),
            active: true,
            connectedClients: 1,
            activeClients: 1,
            timeoutState: TimeoutState.NONE,
          }),
        );
      } else {
        const challenge = await this.loadChallenge(challengeId, client);
        processor = loadChallengeProcessor(
          this.challengeDataRepository,
          this.priceTracker,
          challenge!,
        );
      }

      const challengeClient: ChallengeClient = {
        userId,
        type: recordingType,
        active: true,
        stage,
        stageStatus: StageStatus.ENTERED,
        lastCompletedStage: Stage.UNKNOWN,
      };

      multi.hSet(
        challengeClientsKey(challengeId),
        userId,
        JSON.stringify(challengeClient),
      );

      return multi.exec();
    });

    if (processor === null) {
      // This should never happen as processor is set in every branch, but log
      // some basic debugging information just in case.
      logger.error(
        'Failed to start challenge for user %d: type=%d, stage=%d, party=%s',
        userId,
        type,
        stage,
        party.join(','),
      );
      throw new Error('Failed to start challenge');
    }

    // @ts-ignore: `processor` is set within the transaction callback.
    const p: ChallengeProcessor = processor;

    p.addRecorder(userId, recordingType);
    return p.getUuid();
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
      await client.watch(challengeKey);
      const multi = client.multi();

      multi.del(clientChallengesKey(userId));

      const challenge = await this.loadChallenge(challengeId, client);
      if (challenge === null || !challenge.active) {
        logger.warn(`Challenge ${challengeId} is no longer active`);
        return multi.exec();
      }

      allClientsFinished = challenge.activeClients === 1;
      if (!allClientsFinished) {
        // If there are still clients connected, set a short timeout to allow
        // their own finish requests to complete.
        const timeout: ChallengeTimeout = {
          timestamp: Date.now() + 1500,
          maxRetryAttempts: 1,
          retryIntervalMs: 1500,
        };
        multi.hSet(challengeKey, 'timeoutState', TimeoutState.CLEANUP);
        multi.hSet(
          ChallengeStore.CHALLENGE_TIMEOUT_KEY,
          challengeId,
          JSON.stringify(timeout),
        );
      }

      multi.hIncrBy(challengeKey, 'activeClients', -1);
      multi.hIncrBy(challengeKey, 'connectedClients', -1);

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

    if (allClientsFinished) {
      await this.cleanupChallenge(challengeId, null);
    }
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

    const challenge = await this.loadChallenge(challengeId);
    if (challenge === null) {
      logger.warn(
        `Player ${userId} attempted to update non-existent challenge`,
      );
      return false;
    }

    const processor = loadChallengeProcessor(
      this.challengeDataRepository,
      this.priceTracker,
      challenge,
    );

    if (update.mode !== ChallengeMode.NO_MODE) {
      // Entry mode tracking is currently disabled.
      if (update.mode === ChallengeMode.TOB_ENTRY) {
        logger.info(`Ending ToB entry mode challenge ${challengeId}`);
        await this.cleanupChallenge(challengeId, null);
        return true;
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
        return false;
      }

      let finishStage: Stage | null = null;

      await this.watchTransaction(async (client) => {
        client.watch(challengeClientsKey(challengeId));
        const multi = client.multi();

        const clients = await this.loadChallengeClients(challengeId, client);

        const us = clients.find((c) => c.userId === userId);
        if (us === undefined) {
          logger.warn(
            `User ${userId} attempted to update challenge ${challengeId} ` +
              'but is not currently in the challenge',
          );
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
          } else if (challenge.timeoutState !== TimeoutState.STAGE_END) {
            const timeout: ChallengeTimeout = {
              timestamp: Date.now() + ChallengeStore.STAGE_END_TIMEOUT,
              maxRetryAttempts: 0,
              retryIntervalMs: 0,
            };
            multi.hSet(
              challengesKey(challengeId),
              'timeoutState',
              TimeoutState.STAGE_END,
            );
            multi.hSet(
              ChallengeStore.CHALLENGE_TIMEOUT_KEY,
              challengeId,
              JSON.stringify(timeout),
            );
          }
        } else {
          // Entering a new stage.
          processor.setStage(stageUpdate.stage);
        }

        multi.hSet(
          challengeClientsKey(challengeId),
          userId,
          JSON.stringify(us),
        );

        return multi.exec();
      });

      if (finishStage !== null) {
        setTimeout(
          () => this.loadAndCompleteChallengeStage(challengeId, finishStage!),
          0,
        );
      }
    }

    const updates = await processor.finalizeUpdates();
    await this.client.hSet(
      challengesKey(challengeId),
      toRedis({ ...challenge, ...updates }),
    );

    return true;
  }

  private async processEvents() {
    await this.eventClient.connect();

    while (this.eventQueueActive) {
      const res = await this.eventClient.blPop(CLIENT_EVENTS_KEY, 0);
      if (res === null) {
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

  private async addClient(): Promise<void> {
    // TODO(frolv)
  }

  private async removeClient(id: number, challengeId: string): Promise<void> {
    const challenge = challengesKey(challengeId);

    await this.client.executeIsolated(async (client) => {
      await client.watch(challenge);
      const multi = client.multi();

      multi.del(clientChallengesKey(id));

      const connected = await client.hGet(challenge, 'connectedClients');
      if (connected === undefined) {
        logger.debug(`Challenge ${challengeId} no longer exists`);
        return multi.exec();
      }

      multi.hIncrBy(challenge, 'connectedClients', -1);
      multi.hIncrBy(challenge, 'activeClients', -1);
      multi.hDel(challengeClientsKey(challengeId), id.toString());

      if (connected === '1') {
        const timeout: ChallengeTimeout = {
          timestamp: Date.now() + ChallengeStore.MAX_RECONNECTION_PERIOD,
          maxRetryAttempts: 3,
          retryIntervalMs: ChallengeStore.MAX_RECONNECTION_PERIOD,
        };
        multi.hSet(
          challengesKey(challengeId),
          'timeoutState',
          TimeoutState.CLEANUP,
        );
        multi.hSet(
          ChallengeStore.CHALLENGE_TIMEOUT_KEY,
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
    const challenge = challengesKey(challengeId);
    // TODO(frolv)
  }

  private async setClientInactive(
    id: number,
    challengeId: string,
  ): Promise<void> {
    const challenge = challengesKey(challengeId);
    // TODO(frolv)
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

    return this.completeChallengeStage(challenge, processor, stage);
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
      multi.hDel(ChallengeStore.CHALLENGE_TIMEOUT_KEY, challenge.uuid);
      await multi.exec();
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
      await this.client.del(challengeStageStreamKey(challenge.uuid, stage));
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
      await this.client.hSet(
        challengesKey(challenge.uuid),
        toRedis({ ...challenge, ...updates }),
      );
    }

    await this.client.del(challengeStageStreamKey(challenge.uuid, stage));
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

      const connected = await client.hGet(challengeKey, 'connectedClients');
      if (connected === undefined) {
        logger.debug(`Challenge ${challengeId} no longer exists`);
        return multi.exec();
      }

      const requireCleanup = timeout === null || timeout.maxRetryAttempts === 0;

      if (requireCleanup || connected === '0') {
        multi.hSet(challengeKey, 'active', 0);
        okToCleanup = true;
      } else {
        const nextTimeout: ChallengeTimeout = {
          timestamp: Date.now() + timeout.retryIntervalMs,
          maxRetryAttempts: timeout.maxRetryAttempts - 1,
          retryIntervalMs: timeout.retryIntervalMs,
        };
        multi.hSet(
          ChallengeStore.CHALLENGE_TIMEOUT_KEY,
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

    if (challenge !== null) {
      const processor = loadChallengeProcessor(
        this.challengeDataRepository,
        this.priceTracker,
        challenge,
      );

      // Handle any outstanding stage events.
      await this.completeChallengeStage(challenge, processor, challenge.stage);
      await processor.finish();

      await this.deleteRedisChallengeData(
        challengeId,
        challenge.type,
        challenge.party,
      );
    } else {
      await this.deleteRedisChallengeData(challengeId);
    }

    const update: ChallengeServerUpdate = {
      id: challengeId,
      action: ChallengeUpdateAction.FINISH,
    };
    await this.client.publish(
      CHALLENGE_UPDATES_PUBSUB_KEY,
      JSON.stringify(update),
    );
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
    const multi = this.client.multi();
    multi.del(challengesKey(id));
    multi.del(challengeClientsKey(id));
    multi.hDel(ChallengeStore.CHALLENGE_TIMEOUT_KEY, id);

    if (type !== undefined && party !== undefined) {
      multi.lRem(partyKeyChallengeList(type, party), 1, id);
    }

    await multi.exec();
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

  private async processChallengeTimeouts() {
    this.timeoutTaskTimer = null;

    while (true) {
      let challenges: Record<string, string>;
      try {
        challenges = await this.client.hGetAll(
          ChallengeStore.CHALLENGE_TIMEOUT_KEY,
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
        } else if (state === TimeoutState.STAGE_END) {
          const clients = await this.loadChallengeClients(timedOutChallenge);
          const stage = clients.reduce(
            (acc, c) => Math.max(acc, c.lastCompletedStage),
            Stage.UNKNOWN,
          );
          const uncompletedClients = clients.filter(
            (c) => c.lastCompletedStage < stage,
          );

          logger.debug(
            `Forcing stage ${stage} end for challenge ${timedOutChallenge} ` +
              `after timeout (${uncompletedClients.length} uncompleted clients)`,
          );
          await this.loadAndCompleteChallengeStage(timedOutChallenge, stage);
        } else {
          logger.warn(
            `Timed-out challenge ${timedOutChallenge} has unknown timeout state ` +
              `${state}; ignoring`,
          );
          await this.client.hDel(
            ChallengeStore.CHALLENGE_TIMEOUT_KEY,
            timedOutChallenge,
          );
          // Try to find another timed-out challenge.
          continue;
        }
      }

      break;
    }

    if (this.manageTimeouts) {
      this.timeoutTaskTimer = setTimeout(
        () => this.processChallengeTimeouts(),
        ChallengeStore.CHALLENGE_TIMEOUT_INTERVAL,
      );
    }
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
