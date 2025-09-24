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
  public static async lookupUsername(id: number): Promise<string | null> {
    const [player] = await sql`SELECT username FROM players WHERE id = ${id}`;
    return player?.username ?? null;
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
