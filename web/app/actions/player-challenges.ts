'use server';

import { ChallengeType } from '@blert/common';

import { sql } from './db';

export async function countUniquePlayersForType(
  type: ChallengeType,
): Promise<number> {
  const [row] = await sql<[{ count: string }]>`
    SELECT COUNT(DISTINCT player_id) AS count
    FROM mv_daily_player_challenges
    WHERE challenge_type = ${type}
  `;

  return parseInt(row.count);
}
