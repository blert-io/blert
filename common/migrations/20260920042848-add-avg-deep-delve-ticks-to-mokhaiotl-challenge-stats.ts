import { TransactionSql } from 'postgres';

export async function migrate(sql: TransactionSql) {
  await sql`
    ALTER TABLE mokhaiotl_challenge_stats
    ADD COLUMN avg_deep_delve_ticks INTEGER
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_mokhaiotl_challenge_stats_avg_deep_delve_ticks
    ON mokhaiotl_challenge_stats (avg_deep_delve_ticks)
  `;
}
