import { Sql } from 'postgres';

export async function migrate(sql: Sql) {
  await sql`
    ALTER TABLE mokhaiotl_challenge_stats
    ADD COLUMN max_completed_delve INTEGER NOT NULL DEFAULT 0
  `;
  await sql`
    ALTER TABLE player_stats
    ADD COLUMN mokhaiotl_delves_completed INTEGER NOT NULL DEFAULT 0
  `;
  await sql`
    ALTER TABLE player_stats
    ADD COLUMN mokhaiotl_deep_delves_completed INTEGER NOT NULL DEFAULT 0
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_mokhaiotl_challenge_stats_max_completed_delve
    ON mokhaiotl_challenge_stats (max_completed_delve)
  `;
}
