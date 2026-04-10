import { Sql } from 'postgres';

import { ChallengeStatus, EventType } from '../index';

export async function migrate(sql: Sql) {
  await sql.unsafe(`
    CREATE MATERIALIZED VIEW mv_bloat_downs_daily AS
    SELECT
      c.mode,
      c.scale,
      DATE(c.start_time) AS day,
      qe.custom_short_1 AS down_number,
      qe.custom_short_2 AS walk_ticks,
      COUNT(*)::int AS count
    FROM queryable_events qe
    JOIN challenges c ON c.id = qe.challenge_id
    WHERE qe.event_type = ${EventType.TOB_BLOAT_DOWN}
      AND c.status != ${ChallengeStatus.ABANDONED}
    GROUP BY c.mode, c.scale, DATE(c.start_time), qe.custom_short_1, qe.custom_short_2
    WITH DATA
  `);

  await sql`
    CREATE INDEX idx_mv_bloat_downs_daily_mode_day
      ON mv_bloat_downs_daily (mode, day)
  `;

  await sql`
    CREATE INDEX idx_mv_bloat_downs_daily_down_number
      ON mv_bloat_downs_daily (mode, down_number, day)
  `;

  await sql`
    CREATE UNIQUE INDEX uix_mv_bloat_downs_daily
      ON mv_bloat_downs_daily (mode, day, scale, down_number, walk_ticks)
      NULLS NOT DISTINCT
  `;
}
