import { Sql } from 'postgres';

import { ChallengeStatus } from '../challenge';

export async function migrate(sql: Sql) {
  // Pre-aggregated bloat hand spawn data by challenge mode and day.
  //
  // Uses GROUPING SETS to produce two row types in one MV:
  //   - tile_id IS NOT NULL: per-tile per-order hand counts for heatmaps.
  //   - tile_id IS NULL: per-(mode, day) totals with accurate distinct
  //     challenge counts (each challenge has one mode and one day, so
  //     SUM(challenge_count) across days = exact distinct count).
  //
  // Neither `tile_id` nor `intra_chunk_order` is ever NULL in actual data,
  // so NULL values unambiguously identify totals rows.
  await sql.unsafe(`
    CREATE MATERIALIZED VIEW mv_bloat_hands_daily AS
    SELECT
      c.mode,
      DATE(c.start_time) AS day,
      bh.tile_id,
      bh.intra_chunk_order,
      COUNT(DISTINCT bh.challenge_id)::int AS challenge_count,
      COUNT(*)::int AS hand_count
    FROM bloat_hands bh
    JOIN challenges c ON c.id = bh.challenge_id
    WHERE c.status != ${ChallengeStatus.ABANDONED}
    GROUP BY GROUPING SETS (
      (c.mode, DATE(c.start_time), bh.tile_id, bh.intra_chunk_order),
      (c.mode, DATE(c.start_time))
    )
    WITH DATA
  `);

  await sql`
    CREATE INDEX idx_mv_bloat_hands_daily_tile_lookup
      ON mv_bloat_hands_daily (mode, day)
      WHERE tile_id IS NOT NULL
  `;

  await sql`
    CREATE INDEX idx_mv_bloat_hands_daily_tile_order_lookup
      ON mv_bloat_hands_daily (mode, intra_chunk_order, day)
      WHERE tile_id IS NOT NULL
  `;

  // Totals lookup: filter by mode, day, scan totals rows.
  await sql`
    CREATE INDEX idx_mv_bloat_hands_daily_totals_lookup
      ON mv_bloat_hands_daily (mode, day)
      WHERE tile_id IS NULL
  `;

  await sql`
    CREATE UNIQUE INDEX uix_mv_bloat_hands_daily
      ON mv_bloat_hands_daily (
        mode, day,
        COALESCE(tile_id, -1::smallint),
        COALESCE(intra_chunk_order, -1::smallint)
      )
  `;
}
