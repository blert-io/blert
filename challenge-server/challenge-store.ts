import {
  CHALLENGE_UPDATES_PUBSUB_KEY,
  ChallengeMode,
  ChallengeStatus,
  ChallengeType,
  ChallengeServerUpdate,
  ChallengeUpdateAction,
  DataRepository,
  Stage,
  StageStatus,
  challengesKey,
  clientChallengesKey,
  partyKeyChallengeList,
  CLIENT_EVENTS_KEY,
  ClientEvent,
  ClientEventType,
  ClientStatusEvent,
  ClientStatus,
} from '@blert/common';
import { RedisClientType, WatchError } from 'redis';
import { v4 as uuidv4 } from 'uuid';

import {
  loadChallengeProcessor,
  newChallengeProcessor,
} from './event-processing';
import logger from './log';

type ChallengeState = {
  id: string;
  type: ChallengeType;
  mode: ChallengeMode;
  stage: Stage;
  status: ChallengeStatus;
  stageStatus: StageStatus;
  party: string[];
  totalStageTicks: number;
  active: boolean;
  connectedClients: number;
  activeClients: number;
};

type RedisChallengeState<T = string> = Record<keyof ChallengeState, string | T>;

function toRedis(state: ChallengeState): RedisChallengeState<number> {
  return {
    ...state,
    active: state.active ? '1' : '0',
    party: state.party.join(','),
  };
}

function fromRedis(state: RedisChallengeState): ChallengeState {
  return {
    id: state.id,
    type: Number.parseInt(state.type) as ChallengeType,
    mode: Number.parseInt(state.mode) as ChallengeMode,
    stage: Number.parseInt(state.stage) as Stage,
    status: Number.parseInt(state.status) as ChallengeStatus,
    stageStatus: Number.parseInt(state.stageStatus) as StageStatus,
    party: state.party.split(','),
    totalStageTicks: Number.parseInt(state.totalStageTicks),
    active: state.active === '1',
    connectedClients: Number.parseInt(state.connectedClients),
    activeClients: Number.parseInt(state.activeClients),
  };
}

export default class ChallengeStore {
  private challengeDataRepository: DataRepository;
  private client: RedisClientType;
  private eventClient: RedisClientType;
  private eventQueueActive: boolean;

  private manageTimeouts: boolean;
  private timeoutTaskTimer: NodeJS.Timeout | null;

  private static readonly CHALLENGE_TIMEOUT_KEY = 'expiring-challenges';
  private static readonly CHALLENGE_TIMEOUT_INTERVAL = 1000;

  /** How long to wait before cleaning up a challenge with no clients. */
  private static readonly MAX_RECONNECTION_PERIOD = 1000 * 60 * 5;

  /**
   * How long to wait before attempting to clean up a challenge not
   * receiving events.
   */
  private static readonly MAX_INACTIVITY_PERIOD = 1000 * 60 * 15;

  public constructor(
    challengeDataRepository: DataRepository,
    client: RedisClientType,
    manageTimeouts: boolean,
  ) {
    this.challengeDataRepository = challengeDataRepository;
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
  ): Promise<string> {
    const partyMembers = party.join(',');
    const partyKeyList = partyKeyChallengeList(type, party);

    let challengeId: string = '';

    // Requests from multiple clients in the same party may arrive around the
    // same time, so we need to ensure that only one challenge is created for
    // the party.
    await this.watchTransaction(async (client) => {
      await client.watch(partyKeyList);
      const multi = client.multi();

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
        multi.hSet(
          challengesKey(challengeId),
          toRedis({
            id: challengeId,
            type,
            mode,
            stage,
            status: ChallengeStatus.IN_PROGRESS,
            stageStatus: StageStatus.ENTERED,
            party,
            totalStageTicks: 0,
            active: true,
            connectedClients: 1,
            activeClients: 1,
          }),
        );
        multi.set(clientChallengesKey(userId), challengeId);

        const challenge = newChallengeProcessor(
          this.challengeDataRepository,
          challengeId,
          type,
          mode,
          stage,
          StageStatus.ENTERED,
          party,
        );
        await challenge.createNew(startTime);
      }

      return multi.exec();
    });

    return challengeId;
  }

  /**
   * Indicates that the client with the given ID has finished a challenge.
   * @param challengeId The challenge ID.
   * @param userId ID of the challenge client.
   */
  public async finish(challengeId: string, userId: number): Promise<void> {
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
        multi.hSet(
          ChallengeStore.CHALLENGE_TIMEOUT_KEY,
          challengeId,
          JSON.stringify(timeout),
        );
      }

      multi.hIncrBy(challengeKey, 'activeClients', -1);
      multi.hIncrBy(challengeKey, 'connectedClients', -1);

      return multi.exec();
    });

    if (allClientsFinished) {
      await this.cleanupChallenge(challengeId, null);
    }
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

  private async addClient(): Promise<void> {}

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

      if (connected === '1') {
        const timeout: ChallengeTimeout = {
          timestamp: Date.now() + ChallengeStore.MAX_RECONNECTION_PERIOD,
          maxRetryAttempts: 3,
          retryIntervalMs: ChallengeStore.MAX_RECONNECTION_PERIOD,
        };
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
  ): Promise<void> {}

  private async setClientInactive(
    id: number,
    challengeId: string,
  ): Promise<void> {
    const challenge = challengesKey(challengeId);
  }

  /**
   * Cleans up an active challenge. By default, the challenge is only cleaned up
   * if no clients are connected. This can be overridden via the `force` flag.
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
      const processor = await loadChallengeProcessor(
        this.challengeDataRepository,
        challengeId,
        challenge.status,
        challenge.stageStatus,
      );
      if (processor !== null) {
        await processor.finish();
      }

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
    const promises = [
      this.client.del(challengesKey(id)),
      // TODO Remove any client challenge mappings.
      this.client.hDel(ChallengeStore.CHALLENGE_TIMEOUT_KEY, id),
    ];

    if (type !== undefined && party !== undefined) {
      promises.push(
        this.client.lRem(partyKeyChallengeList(type, party), 1, id),
      );
    }

    await Promise.all(promises);
  }

  private async loadChallenge(
    challengeId: string,
    client?: RedisClientType,
  ): Promise<ChallengeState | null> {
    const c = client ?? this.client;
    const state = await c.hGetAll(challengesKey(challengeId));
    if (Object.keys(state).length === 0) {
      return null;
    }
    return fromRedis(state as RedisChallengeState);
  }

  private async processChallengeTimeouts() {
    this.timeoutTaskTimer = null;

    while (true) {
      const challenges = await this.client.hGetAll(
        ChallengeStore.CHALLENGE_TIMEOUT_KEY,
      );

      const now = Date.now();
      let challengeToCleanup: string | null = null;
      let cleanupTimeout: ChallengeTimeout | null = null;

      for (const challengeId in challenges) {
        const timeout = JSON.parse(challenges[challengeId]) as ChallengeTimeout;
        if (timeout.timestamp <= now) {
          challengeToCleanup = challengeId;
          cleanupTimeout = timeout;
          break;
        }
      }

      if (challengeToCleanup === null) {
        // Wait until the next timeout check for more challenges.
        break;
      }

      logger.info(`Cleaning up expired challenge ${challengeToCleanup}`);
      await this.cleanupChallenge(challengeToCleanup, cleanupTimeout);

      if (true) {
        break;
      }
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
