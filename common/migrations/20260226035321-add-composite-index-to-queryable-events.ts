import { Sql } from 'postgres';

export async function migrate(sql: Sql) {
  await sql`
    CREATE INDEX IF NOT EXISTS idx_queryable_events_challenge_type_stage_subtype
    ON queryable_events (challenge_id, event_type, stage, subtype)
  `;

  await sql`DROP INDEX IF EXISTS idx_queryable_events_challenge_id`;
  await sql`DROP INDEX IF EXISTS idx_queryable_events_event_type_subtype`;
  await sql`DROP INDEX IF EXISTS idx_queryable_events_stage_mode`;
}
