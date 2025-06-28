import { Sql } from 'postgres';

export async function migrate(sql: Sql) {
  await sql`
    CREATE TABLE personal_best_history (
      id SERIAL PRIMARY KEY,
      player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      challenge_split_id INTEGER NOT NULL REFERENCES challenge_splits(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE INDEX idx_pb_history_player_id ON personal_best_history(player_id)
  `;
  await sql`
    CREATE INDEX idx_pb_history_player_created_at ON personal_best_history(player_id, created_at DESC)
  `;
  await sql`
    CREATE INDEX idx_pb_history_challenge_split_id ON personal_best_history(challenge_split_id)
  `;
}
