import { Sql } from 'postgres';

export async function migrate(sql: Sql) {
  await sql`
    ALTER TABLE challenge_sessions
    ADD COLUMN IF NOT EXISTS sort_time TIMESTAMPTZ
    GENERATED ALWAYS AS (COALESCE(end_time, start_time)) STORED
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_challenge_sessions_sort_time_visible
    ON challenge_sessions (sort_time DESC, id DESC)
    WHERE status <> 2
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_pb_history_player_created_at_id
    ON personal_best_history (player_id, created_at DESC, id DESC)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_challenge_splits_id_inc
    ON challenge_splits (id) INCLUDE (type, scale, ticks, challenge_id)
  `;
}
