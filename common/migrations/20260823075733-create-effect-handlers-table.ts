import { TransactionSql } from 'postgres';

export async function migrate(sql: TransactionSql) {
  await sql`
    CREATE TABLE effect_handlers (
      handler TEXT NOT NULL,
      kind SMALLINT NOT NULL,
      registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (handler, kind)
    )
  `;
}
