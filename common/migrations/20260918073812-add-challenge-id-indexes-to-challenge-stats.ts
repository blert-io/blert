import { Sql } from 'postgres';

export const transactional = false;

export async function migrate(sql: Sql) {
  await sql`
    CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uix_tob_challenge_stats_challenge_id
      ON tob_challenge_stats (challenge_id)
  `;
  await sql`
    CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uix_mokhaiotl_challenge_stats_challenge_id
      ON mokhaiotl_challenge_stats (challenge_id)
  `;
  await sql`
    CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uix_inferno_challenge_stats_challenge_id
      ON inferno_challenge_stats (challenge_id)
  `;
  await sql`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_players_normalized_username
      ON players (normalized_username)
  `;
}
