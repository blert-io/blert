import { Sql } from 'postgres';

export async function migrate(sql: Sql) {
  await sql`
    CREATE TYPE gear_setup_vote_type AS ENUM ('like', 'dislike')
  `;

  await sql`
    CREATE TABLE gear_setup_votes (
      setup_id BIGINT NOT NULL REFERENCES gear_setups (id) ON DELETE CASCADE,
      user_id INT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      vote_type gear_setup_vote_type NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (setup_id, user_id)
    )
  `;

  await sql`
    CREATE INDEX idx_gear_setup_votes_user_id ON gear_setup_votes (user_id)
  `;

  await sql`
    CREATE INDEX idx_gear_setup_votes_setup_id_type ON gear_setup_votes (setup_id, vote_type)
  `;
}
