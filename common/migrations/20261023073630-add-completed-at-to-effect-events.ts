import { TransactionSql } from 'postgres';

export async function migrate(sql: TransactionSql) {
  await sql`ALTER TABLE effect_events ADD COLUMN completed_at TIMESTAMPTZ`;

  await sql`
    CREATE INDEX idx_effect_events_incomplete
      ON effect_events (id)
      WHERE completed_at IS NULL
  `;
}
