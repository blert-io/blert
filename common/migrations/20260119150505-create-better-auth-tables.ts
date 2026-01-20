import { Sql } from 'postgres';

export async function migrate(sql: Sql) {
  await migrateUsers(sql);
  await createBetterAuthTables(sql);
  await migrateAccounts(sql);
}

async function migrateUsers(sql: Sql) {
  await sql`
    ALTER TABLE users
    ADD COLUMN display_username VARCHAR(30),
    ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ADD COLUMN image TEXT
  `;

  // BetterAuth puts passwords in the `accounts` table.
  await sql`ALTER TABLE users ALTER COLUMN password DROP NOT NULL`;

  await sql`
    UPDATE users
    SET display_username = username
    WHERE display_username IS NULL
  `;

  await sql`
    UPDATE users
    SET username = lower(username)
    WHERE username <> lower(username)
  `;
}

async function createBetterAuthTables(sql: Sql) {
  await sql`
    CREATE TABLE account (
      id BIGSERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      account_id TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      password TEXT,
      access_token TEXT,
      refresh_token TEXT,
      access_token_expires_at TIMESTAMPTZ,
      refresh_token_expires_at TIMESTAMPTZ,
      scope TEXT,
      id_token TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE INDEX idx_account_user_id ON account(user_id)
  `;

  await sql`
    CREATE UNIQUE INDEX uix_account_provider_id_account_id
      ON account(provider_id, account_id)
  `;

  await sql`
    CREATE TABLE session (
      id BIGSERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE INDEX idx_session_user_id ON session(user_id)
  `;

  await sql`
    CREATE TABLE verification (
      id BIGSERIAL PRIMARY KEY,
      identifier TEXT NOT NULL,
      value TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE INDEX idx_verification_identifier ON verification(identifier)
  `;
}

async function migrateAccounts(sql: Sql) {
  await sql`
    INSERT INTO account (
      user_id,
      account_id,
      provider_id,
      password,
      created_at,
      updated_at
    )
    SELECT id, id::text, 'credential', password, created_at, NOW()
    FROM users
    WHERE password IS NOT NULL
    ON CONFLICT (provider_id, account_id) DO NOTHING
  `;
}
