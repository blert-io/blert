import { Sql } from 'postgres';

export async function migrate(sql: Sql) {
  await sql`
    CREATE INDEX IF NOT EXISTS idx_challenges_start_time
    ON challenges (start_time DESC)
  `;
}
