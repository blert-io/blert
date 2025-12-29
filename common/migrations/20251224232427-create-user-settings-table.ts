import { Sql } from 'postgres';

export async function migrate(sql: Sql) {
  await sql`
    CREATE TABLE user_settings (
      user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      key VARCHAR(64) NOT NULL,
      value JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, key)
    )
  `;
}
