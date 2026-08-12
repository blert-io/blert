import { Sql } from 'postgres';

export const transactional = false;

export async function migrate(sql: Sql) {
  await sql`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_challenges_session_id_start_time
      ON challenges (session_id, start_time, id)
  `;
  await sql`
    DROP INDEX CONCURRENTLY idx_challenges_session_id
  `;

  await sql`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_challenge_players_challenge_id_player_id
      ON challenge_players (challenge_id, player_id)
  `;
  await sql`
    DROP INDEX CONCURRENTLY idx_challenge_players_challenge_id
  `;
}
