import { Sql } from 'postgres';

export async function migrate(sql: Sql) {
  await sql`
    CREATE TABLE bloat_downs (
      challenge_id BIGINT NOT NULL REFERENCES challenges (id) ON DELETE CASCADE,
      down_number SMALLINT NOT NULL,
      down_tick INT NOT NULL,
      walk_ticks SMALLINT NOT NULL,
      accurate BOOLEAN NOT NULL DEFAULT false,
      PRIMARY KEY (challenge_id, down_number)
    )
  `;

  await sql`
    CREATE INDEX idx_bloat_downs_walk_ticks
      ON bloat_downs (down_number, walk_ticks, challenge_id)
  `;

  await sql`
    CREATE INDEX idx_bloat_downs_walk_ticks_accurate
      ON bloat_downs (down_number, walk_ticks, challenge_id)
      WHERE accurate
  `;

  await sql`
    ALTER TABLE tob_challenge_stats
      ADD COLUMN bloat_down_count SMALLINT
  `;
}
