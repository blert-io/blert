import { Sql } from 'postgres';

export async function migrate(sql: Sql) {
  await sql`
    CREATE TABLE bloat_hands (
      challenge_id BIGINT NOT NULL REFERENCES challenges (id) ON DELETE CASCADE,
      wave_number SMALLINT NOT NULL,
      tile_id SMALLINT,
      chunk SMALLINT NOT NULL,
      intra_chunk_order SMALLINT NOT NULL
    )
  `;

  await sql`
    CREATE INDEX idx_bloat_hands_tile_id ON bloat_hands (tile_id)
  `;

  await sql`
    CREATE INDEX idx_bloat_hands_wave_tile ON bloat_hands (wave_number, tile_id)
  `;

  await sql`
    CREATE INDEX idx_bloat_hands_chunk_order ON bloat_hands (chunk, intra_chunk_order)
  `;

  await sql`
    CREATE INDEX idx_bloat_hands_challenge_id ON bloat_hands (challenge_id)
  `;
}
