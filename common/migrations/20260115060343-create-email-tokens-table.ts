import { Sql } from 'postgres';

export async function migrate(sql: Sql) {
  await sql`
    CREATE TABLE email_tokens (
      id INT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      user_id INT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      type VARCHAR(20) NOT NULL,
      token VARCHAR(64) NOT NULL UNIQUE,
      email VARCHAR(128) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ
    )
  `;

  await sql`
    CREATE INDEX idx_email_tokens_user_id_type ON email_tokens(user_id, type)
  `;

  await sql`
    CREATE INDEX idx_email_tokens_expires_at ON email_tokens(expires_at)
  `;

  await sql`
    ALTER TABLE users
    ADD COLUMN pending_email VARCHAR(128)
  `;
}
