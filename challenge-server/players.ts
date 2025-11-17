import {
  PlayerStats,
  Player,
  camelToSnakeObject,
  CamelToSnakeCase,
  camelToSnake,
} from '@blert/common';

import sql from './db';
import { startOfDateUtc } from './time';

export type ModifiablePlayerStats = Omit<PlayerStats, 'date' | 'playerId'>;

export class Players {
  private static readonly USERNAME_REGEX = /^[a-zA-Z0-9 _-]{1,12}$/;

  public static async lookupUsername(id: number): Promise<string | null> {
    const [player] = await sql<
      [{ username: string }?]
    >`SELECT username FROM players WHERE id = ${id}`;
    return player?.username ?? null;
  }

  /**
   * Finds player IDs corresponding to usernames.
   *
   * @param usernames The usernames to look up.
   * @returns The IDs of the players, in the same order as the input usernames.
   */
  public static async lookupIds(usernames: string[]): Promise<number[]> {
    const rows = await sql<{ id: number; username: string }[]>`
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
    const [lastStats] = await sql<
      ({ id?: number } & CamelToSnakeCase<PlayerStats>)[]
    >`
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
        updates[k]! += lastStats[k];
      }
      await sql`
        UPDATE player_stats SET ${sql(updates)} WHERE id = ${lastStats.id!}
      `;
      return;
    }

    if (insert !== null) {
      await sql`INSERT INTO player_stats ${sql(insert)}`;
    }
  }
}
