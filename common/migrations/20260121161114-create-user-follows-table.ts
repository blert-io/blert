import { Sql } from 'postgres';

export async function migrate(sql: Sql) {
  await sql`
    CREATE TABLE user_follows (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, player_id)
    )
  `;

  await sql`
    CREATE INDEX idx_user_follows_player_id ON user_follows(player_id)
  `;

  await sql`
    CREATE INDEX idx_user_follows_user_id_created_at_id ON user_follows(user_id, created_at DESC)
  `;
}
