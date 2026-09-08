import { ChallengeStatus } from '@blert/common';

import { Sql } from './db';

/**
 * Looks up the status of a challenge.
 * @param sql Database client.
 * @param uuid UUID of the challenge.
 * @returns The challenge's status, or null if no such challenge exists.
 */
export async function challengeStatus(
  sql: Sql,
  uuid: string,
): Promise<ChallengeStatus | null> {
  const rows = await sql<{ status: ChallengeStatus }[]>`
    SELECT status FROM challenges WHERE uuid = ${uuid}
  `;
  return rows.length > 0 ? rows[0].status : null;
}
