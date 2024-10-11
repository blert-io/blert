import {
  PlayerStats,
  Player,
  activePlayerKey,
  camelToSnakeObject,
  CamelToSnakeCase,
  camelToSnake,
} from '@blert/common';
import { RedisClientType } from 'redis';

import sql from './db';

export type ModifiablePlayerStats = Omit<PlayerStats, 'date' | 'playerId'>;

function startOfDateUtc(): Date {
  let date = new Date();
  date.setUTCHours(0);
  date.setUTCMinutes(0);
  date.setUTCSeconds(0);
  date.setUTCMilliseconds(0);
  return date;
}

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
  private static readonly USERNAME_REGEX = /^[a-zA-Z0-9 _-]{1,12}$/;

  public static async lookupUsername(id: number): Promise<string | null> {
    const [player] = await sql`SELECT username FROM players WHERE id = ${id}`;
    return player?.username ?? null;
  }

  /**
   * Finds player IDs corresponding to usernames.
   *
   * @param usernames The usernames to look up.
   * @returns The IDs of the players, in the same order as the input usernames.
   */
  public static async lookupIds(usernames: string[]): Promise<number[]> {
    const rows = await sql`
      SELECT id, username
      FROM players
      WHERE lower(username) = ANY(${usernames.map((u) => u.toLowerCase())})
    `;
    const result: number[] = [];
    for (const username of usernames) {
      const row = rows.find((r) => r.username === username);
      if (row !== undefined) {
        result.push(row.id);
      }
    }
    return result;
  }

  /**
   * Finds the ID of a player by their username.
   *
   * @param username The player's username.
   * @returns The player's ID, or null if the player does not exist.
   */
  public static async lookupId(username: string): Promise<number | null> {
    const [id] = await Players.lookupIds([username]);
    return id ?? null;
  }

  /**
   * Creates a new player in the database.
   * @param username The in-game username of the player.
   * @param initialFields Optional fields to set on the new player.
   * @returns Whether the player was created successfully.
   */
  public static async create(
    username: string,
    initialFields?: Partial<Player>,
  ): Promise<number | null> {
    let fields: CamelToSnakeCase<Partial<Player>> = {};

    if (initialFields !== undefined) {
      fields = camelToSnakeObject(initialFields);
    }

    if (!Players.USERNAME_REGEX.test(username)) {
      throw new Error(`Invalid RuneScape username: ${username}`);
    }

    fields.username = username;

    const [player]: [{ id: number }?] = await sql`
      INSERT INTO players ${sql(fields)} RETURNING id;
    `;

    return player?.id ?? null;
  }

  public static async startChallenge(username: string): Promise<number | null> {
    const [player]: [{ id: number }?] = await sql`
      UPDATE players
      SET total_recordings = total_recordings + 1
      WHERE lower(username) = ${username.toLowerCase()}
      RETURNING id;
    `;

    if (player !== undefined) {
      return player.id;
    }

    return await Players.create(username, { totalRecordings: 1 });
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

    await sql`
      UPDATE players
      SET ${sql(updates)}, last_updated = NOW()
      WHERE lower(username) = ${username.toLowerCase()}
    `;
  }

  /**
   * Modifies a player's stats in the database.
   *
   * @param playerId The ID of the player whose stats to update.
   * @param statsIncrements The changes to apply to the player's stats.
   */
  public static async updateStats(
    playerId: number,
    statsIncrements: Partial<ModifiablePlayerStats>,
  ): Promise<void> {
    const startOfDay = startOfDateUtc();
    const [lastStats] = await sql`
      SELECT * FROM player_stats
      WHERE player_id = ${playerId}
      ORDER BY date DESC
      LIMIT 1
    `;

    let insert = null;
    if (lastStats === undefined) {
      insert = {
        ...camelToSnakeObject(statsIncrements),
        date: startOfDay,
        player_id: playerId,
      };
    } else if (lastStats.date.getTime() !== startOfDay.getTime()) {
      delete lastStats.id;
      insert = {
        ...(lastStats as CamelToSnakeCase<PlayerStats>),
        date: startOfDay,
      };

      for (const key in statsIncrements) {
        const k = camelToSnake(
          key,
        ) as keyof CamelToSnakeCase<ModifiablePlayerStats>;
        insert[k] += statsIncrements[key as keyof ModifiablePlayerStats]!;
      }
    } else {
      const updates = camelToSnakeObject(statsIncrements);
      for (const key in updates) {
        const k = key as keyof CamelToSnakeCase<ModifiablePlayerStats>;
        updates[k] += lastStats[k];
      }
      await sql`
        UPDATE player_stats SET ${sql(updates)} WHERE id = ${lastStats.id}
      `;
      return;
    }

    if (insert !== null) {
      await sql`INSERT INTO player_stats ${sql(insert)}`;
    }
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
      console.error(
        `Tried to remove ${username} from challenge ${challengeId}, ` +
          `but they are in ${activePlayer.challengeId}`,
      );
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
