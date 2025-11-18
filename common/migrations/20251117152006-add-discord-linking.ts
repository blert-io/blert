import { Sql } from 'postgres';

export async function migrate(sql: Sql) {
  await sql`
    CREATE TABLE account_linking_codes (
      id INT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      user_id INT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      type VARCHAR(20) NOT NULL,
      code VARCHAR(8) NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      UNIQUE (user_id, type)
    )
  `;

  await sql`
    CREATE INDEX idx_account_linking_codes_expires_at
    ON account_linking_codes(expires_at)
  `;

  await sql`
    ALTER TABLE users
    ADD COLUMN discord_id VARCHAR(20) UNIQUE,
    ADD COLUMN discord_username VARCHAR(37)
  `;

  await sql`
    CREATE INDEX idx_users_discord_id ON users(discord_id)
  `;
}
