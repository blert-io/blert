import { Sql } from 'postgres';

export async function migrate(sql: Sql) {
  await sql`
    CREATE MATERIALIZED VIEW mv_daily_player_pairs AS
    SELECT
      LEAST(p1.player_id, p2.player_id) AS player_id_1,
      GREATEST(p1.player_id, p2.player_id) AS player_id_2,
      DATE(c.start_time) AS day_bucket,
      c.type AS challenge_type,
      c.mode AS challenge_mode,
      c.scale AS challenge_scale,
      COUNT(*) AS challenge_count
    FROM challenge_players p1
    JOIN challenge_players p2 USING (challenge_id)
    JOIN challenges c ON c.id = p1.challenge_id
    WHERE p1.player_id < p2.player_id
    GROUP BY 1, 2, 3, 4, 5, 6
    WITH DATA;
  `;

  await sql`
    CREATE UNIQUE INDEX uix_mv_daily_player_pairs_pk
      ON mv_daily_player_pairs (player_id_1, player_id_2, day_bucket, challenge_type, challenge_mode, challenge_scale);
  `;

  await sql`
    CREATE INDEX idx_mv_daily_player_pairs_network
      ON mv_daily_player_pairs (challenge_type, challenge_mode, day_bucket);
  `;

  await sql`
    CREATE INDEX idx_mv_daily_player_pairs_any_player
      ON mv_daily_player_pairs (player_id_1, player_id_2, day_bucket);
  `;
}
