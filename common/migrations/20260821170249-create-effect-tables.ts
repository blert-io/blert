import { TransactionSql } from 'postgres';

export async function migrate(sql: TransactionSql) {
  await sql`
    CREATE TYPE delivery_status AS ENUM (
      'pending', 'delivered', 'failed', 'skipped'
    )
  `;

  await sql`
    CREATE TABLE effect_events (
      id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      kind SMALLINT NOT NULL,
      subject JSONB NOT NULL,
      key TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (kind, key)
    )
  `;

  await sql`
    CREATE INDEX idx_effect_events_created_at
      ON effect_events (created_at)
  `;

  await sql`
    CREATE TABLE effect_deliveries (
      event_id BIGINT NOT NULL REFERENCES effect_events (id) ON DELETE CASCADE,
      handler TEXT NOT NULL,
      message_key TEXT NOT NULL,
      status delivery_status NOT NULL DEFAULT 'pending',
      attempts_remaining SMALLINT NOT NULL,
      next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (event_id, handler, message_key)
    )
  `;

  await sql`
    CREATE INDEX idx_effect_deliveries_next_attempt_at
      ON effect_deliveries (next_attempt_at)
      WHERE status = 'pending'
  `;
}
