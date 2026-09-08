import { TransactionSql } from 'postgres';

export async function migrate(sql: TransactionSql) {
  await sql`
    ALTER TABLE challenge_stage_merges
      ALTER COLUMN status DROP NOT NULL,
      ALTER COLUMN last_tick DROP NOT NULL,
      ALTER COLUMN missing_tick_count DROP NOT NULL,
      ALTER COLUMN precise_server_tick_count DROP NOT NULL,
      ALTER COLUMN accurate_until DROP NOT NULL,
      ALTER COLUMN queryable_until DROP NOT NULL,
      ALTER COLUMN reference_method DROP NOT NULL,
      ALTER COLUMN reference_tick_count DROP NOT NULL
  `;
}
