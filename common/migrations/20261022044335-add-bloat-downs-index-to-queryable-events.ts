import { Sql } from 'postgres';

import { EventType } from '../index';

export const transactional = false;

export async function migrate(sql: Sql) {
  await sql.unsafe(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_queryable_events_bloat_downs
      ON queryable_events (challenge_id) INCLUDE (custom_short_1, custom_short_2)
      WHERE event_type = ${EventType.TOB_BLOAT_DOWN}
  `);
}
