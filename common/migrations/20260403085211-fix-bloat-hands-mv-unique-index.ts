import { Sql } from 'postgres';

export async function migrate(sql: Sql) {
  // The original unique index used COALESCE expressions, which PostgreSQL
  // does not accept for REFRESH MATERIALIZED VIEW CONCURRENTLY.
  // Replace with a plain column index using NULLS NOT DISTINCT.
  await sql`
    DROP INDEX uix_mv_bloat_hands_daily
  `;

  await sql`
    CREATE UNIQUE INDEX uix_mv_bloat_hands_daily
      ON mv_bloat_hands_daily (mode, day, tile_id, intra_chunk_order)
      NULLS NOT DISTINCT
  `;
}
