import { TransactionSql } from 'postgres';

export async function migrate(sql: TransactionSql) {
  await sql`
    ALTER TABLE name_changes
    ADD COLUMN attempts INT NOT NULL DEFAULT 0,
    ADD COLUMN next_attempt_at TIMESTAMPTZ
  `;
}
