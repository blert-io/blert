import { Sql } from 'postgres';

export async function migrate(sql: Sql) {
  await sql`
    CREATE INDEX IF NOT EXISTS idx_sessions_status_start_time ON challenge_sessions (status, start_time DESC)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_sessions_duration_finished
    ON challenge_sessions (
      (EXTRACT(EPOCH FROM end_time - start_time))
    )
    WHERE end_time IS NOT NULL
  `;
}
