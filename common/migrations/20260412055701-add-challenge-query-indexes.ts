import { Sql } from 'postgres';

export async function migrate(sql: Sql) {
  await sql`
    CREATE INDEX IF NOT EXISTS idx_challenges_type_mode_scale
    ON challenges (type, mode, scale)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_challenge_splits_challenge_id_type_inc_ticks
    ON challenge_splits (challenge_id, type) INCLUDE (ticks)
    WHERE accurate
  `;
  await sql`DROP INDEX IF EXISTS idx_challenges_type`;
  await sql`DROP INDEX IF EXISTS idx_challenge_splits_challenge_id_type`;
}
