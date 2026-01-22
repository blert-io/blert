import {
  PlayerStats,
  Player,
  activePlayerKey,
  CamelToSnakeCase,
  camelToSnake,
  NameChangeStatus,
} from '@blert/common';
import { RedisClientType } from 'redis';

import sql from './db';
import logger from './log';

export type ModifiablePlayerStats = Omit<PlayerStats, 'date' | 'playerId'>;

type Experience = Pick<
  Player,
  | 'overallExperience'
  | 'attackExperience'
  | 'defenceExperience'
  | 'strengthExperience'
  | 'hitpointsExperience'
  | 'rangedExperience'
  | 'prayerExperience'
  | 'magicExperience'
>;

export class Players {
  public static async lookupUsername(id: number): Promise<string | null> {
    const [player] = await sql<
      { username: string }[]
    >`SELECT username FROM players WHERE id = ${id}`;
    return player?.username ?? null;
  }

  /**
   * Retrieves the account hash for a player, if one has been recorded.
   * @param id The player's ID.
   * @returns The account hash, or null if not set.
   */
  public static async getAccountHash(id: number): Promise<bigint | null> {
    const [player] = await sql<
      { account_hash: bigint | null }[]
    >`SELECT account_hash FROM players WHERE id = ${id}`;
    return player?.account_hash ?? null;
  }

  /**
   * Sets the account hash for a player.
   * @param id The player's ID.
   * @param accountHash The account hash to set.
   */
  public static async setAccountHash(
    id: number,
    accountHash: bigint,
  ): Promise<void> {
    await sql`
      UPDATE players
      SET account_hash = ${accountHash}
      WHERE id = ${id}
    `;
  }

  /**
   * Retrieves a player's ID by their account hash.
   * @param accountHash The account hash to look up.
   * @returns The player's ID, or null if no player has this hash.
   */
  public static async getPlayerByAccountHash(
    accountHash: bigint,
  ): Promise<{ id: number; username: string } | null> {
    const [player] = await sql<
      { id: number; username: string }[]
    >`SELECT id, username FROM players WHERE account_hash = ${accountHash}`;
    return player ?? null;
  }

  /**
   * Queues a name change for processing.
   *
   * @param oldName The player's old username.
   * @param newName The player's new username.
   * @param playerId The player's ID.
   */
  public static async queueNameChange(
    oldName: string,
    newName: string,
    playerId: number,
  ): Promise<void> {
    // Messages from each client are queued and processed sequentially, and it's
    // not possible to log into the same OSRS account multiple times. Therefore,
    // there is no race between checking for an existing name change and inserting
    // a new one.
    const [existingNameChange] = await sql<[{ id: number }?]>`
      SELECT id FROM name_changes
      WHERE player_id = ${playerId}
      AND (
        status = ${NameChangeStatus.PENDING}
        OR status = ${NameChangeStatus.DEFERRED}
      )
    `;
    if (existingNameChange !== undefined) {
      return;
    }

    await sql`
      INSERT INTO name_changes (
        old_name,
        new_name,
        player_id,
        status,
        submitted_at
      )
      VALUES (
        ${oldName},
        ${newName},
        ${playerId},
        ${NameChangeStatus.PENDING},
        NOW()
      )
    `;
  }

  public static async updateExperience(
    username: string,
    experience: Experience,
  ) {
    const updates: Partial<CamelToSnakeCase<Experience>> = {};
    Object.keys(experience).forEach((key) => {
      if (key.endsWith('Experience')) {
        if (experience[key as keyof Experience] > 0) {
          const k = camelToSnake(key) as keyof CamelToSnakeCase<Experience>;
          updates[k] = experience[key as keyof Experience];
        }
      }
    });

    const normalizedUsername = username.toLowerCase();
    if (Object.keys(updates).length === 0) {
      await sql`
        UPDATE players
        SET last_updated = NOW()
        WHERE lower(username) = ${normalizedUsername}
      `;
      return;
    }

    await sql`
      UPDATE players
      SET ${sql(updates)}, last_updated = NOW()
      WHERE lower(username) = ${normalizedUsername}
    `;
  }
}

type ActivePlayer = {
  challengeId: string;
};

type PlayerStatusCallback = (challengeId: string | null) => void;

export class PlayerManager {
  private redisClient: RedisClientType | null;
  private activePlayers = new Map<string, ActivePlayer>();

  private statusUpdateListeners = new Map<string, PlayerStatusCallback[]>();

  public constructor(redisClient: RedisClientType | null) {
    this.redisClient = redisClient;
  }

  public setPlayerActive(username: string, challengeId: string): void {
    this.activePlayers.set(username.toLowerCase(), { challengeId });
    this.statusUpdateListeners
      .get(username.toLowerCase())
      ?.forEach((cb) => cb(challengeId));
  }

  public setPlayerInactive(username: string, challengeId: string): void {
    username = username.toLowerCase();
    const activePlayer = this.activePlayers.get(username);
    if (activePlayer === undefined) {
      return;
    }
    if (activePlayer.challengeId !== challengeId) {
      logger.warn('player_challenge_mismatch', {
        username,
        expectedChallengeUuid: challengeId,
        actualChallengeUuid: activePlayer.challengeId,
      });
      return;
    }
    this.activePlayers.delete(username);
    this.statusUpdateListeners
      .get(username.toLowerCase())
      ?.forEach((cb) => cb(null));
  }

  public async getCurrentChallengeId(username: string): Promise<string | null> {
    if (this.redisClient !== null) {
      const challengeId = await this.redisClient.get(activePlayerKey(username));
      return challengeId ?? null;
    }
    return this.activePlayers.get(username.toLowerCase())?.challengeId ?? null;
  }

  public subscribeToPlayer(
    username: string,
    callback: PlayerStatusCallback,
  ): void {
    username = username.toLowerCase();
    if (!this.statusUpdateListeners.has(username)) {
      this.statusUpdateListeners.set(username, []);
    }

    this.statusUpdateListeners.get(username)!.push(callback);
  }

  public unsubscribeFromPlayer(
    username: string,
    callback: PlayerStatusCallback,
  ): void {
    username = username.toLowerCase();
    if (!this.statusUpdateListeners.has(username)) {
      return;
    }

    const listeners = this.statusUpdateListeners.get(username)!;
    const index = listeners.indexOf(callback);
    if (index !== -1) {
      listeners.splice(index, 1);
    }
  }
}
