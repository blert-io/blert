import { Raid, RecordingType, camelToSnakeObject } from '@blert/common';

import sql from './db';
import { Players } from './players';

export type BasicUser = {
  id: number;
  username: string;
  linkedPlayerId: number;
};

export type PastChallenge = Pick<
  Raid,
  'type' | 'stage' | 'status' | 'mode' | 'party'
> & {
  id: string;
};

export class Users {
  /**
   * Fetches basic information about a user from their API key.
   *
   * @param apiKey The API key to look up.
   * @returns The user's basic information, or null if the key is invalid.
   */
  static async findByApiKey(apiKey: string): Promise<BasicUser | null> {
    const [key]: [{ user_id: number; player_id: number }?] = await sql`
      UPDATE api_keys
      SET last_used = NOW()
      WHERE key = ${apiKey}
      RETURNING user_id, player_id;
    `;

    if (key === undefined) {
      return null;
    }

    const [user] =
      await sql`SELECT username FROM users WHERE id = ${key.user_id}`;
    if (user === null) {
      console.error(`API key ${apiKey} does not belong to a user; deleting.`);
      await sql`DELETE FROM api_keys WHERE key = ${apiKey}`;
      return null;
    }

    if ((await Players.lookupUsername(key.player_id)) === null) {
      console.error(`API key ${apiKey} does not belong to a player`);
      return null;
    }

    return {
      id: key.user_id,
      username: user.username,
      linkedPlayerId: key.player_id,
    };
  }

  /**
   * Adds a recorded challenge to a user's history.
   *
   * @param userId ID of the user.
   * @param challengeId Database ID of the challenge.
   * @param recordingType Type of recording.
   */
  static async addRecordedChallenge(
    userId: number,
    challengeId: number,
    recordingType: RecordingType,
  ): Promise<void> {
    await sql`
      INSERT INTO recorded_challenges (challenge_id, recorder_id, recording_type)
      VALUES (${challengeId}, ${userId}, ${recordingType})
    `;
  }

  /**
   * Retrieves the most recent challenges recorded by a user.
   *
   * @param userId ID of the user to look up.
   * @param limit Maximum number of challenges to return.
   * @returns List of challenges, ordered by most recent first.
   */
  static async getChallengeHistory(
    userId: number,
    limit: number = 10,
  ): Promise<PastChallenge[]> {
    const recordedChallenges = await sql`
      SELECT
        challenges.id,
        challenges.uuid,
        challenges.type,
        challenges.stage,
        challenges.status,
        challenges.mode
      FROM challenges
      JOIN recorded_challenges ON challenges.id = recorded_challenges.challenge_id
      WHERE recorded_challenges.recorder_id = ${userId}
      ORDER BY challenges.start_time DESC
      LIMIT ${limit}
    `;

    const players = await sql`
      SELECT challenge_id, username
      FROM challenge_players
      WHERE challenge_id = ANY(${recordedChallenges.map((r) => r.id)})
      ORDER BY challenge_id, orb ASC
    `;

    const parties = players.reduce((acc, player) => {
      if (acc[player.challenge_id] === undefined) {
        acc[player.challenge_id] = [];
      }
      acc[player.challenge_id].push(player.username);
      return acc;
    }, {});

    return recordedChallenges.map((c) => ({
      id: c.uuid,
      type: c.type,
      stage: c.stage,
      status: c.status,
      mode: c.mode,
      party: parties[c.id],
    }));
  }
}
