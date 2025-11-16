import { Sql } from 'postgres';

export async function migrate(sql: Sql) {
  await sql`
    CREATE TABLE blertcoin_accounts (
      id            BIGSERIAL PRIMARY KEY,
      owner_user_id INTEGER,
      kind          TEXT NOT NULL CHECK (kind IN ('user','treasury','sink','liability','escrow')),
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;

  await sql`
    CREATE UNIQUE INDEX uix_blertcoin_user_account_per_user
      ON blertcoin_accounts(owner_user_id)
      WHERE kind = 'user';
  `;

  await sql`
    CREATE UNIQUE INDEX uix_blertcoin_liability_account_per_user
      ON blertcoin_accounts(owner_user_id)
      WHERE kind = 'liability';
  `;

  await sql`
    CREATE TABLE blertcoin_system_accounts (
      name TEXT PRIMARY KEY,
      account_id BIGINT UNIQUE NOT NULL REFERENCES blertcoin_accounts(id) ON DELETE RESTRICT
    );
  `;

  await sql`
    CREATE TABLE blertcoin_account_balances (
      account_id BIGINT PRIMARY KEY REFERENCES blertcoin_accounts(id) ON DELETE CASCADE,
      balance    BIGINT NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;

  await sql`
    CREATE FUNCTION check_balance_by_account_type()
    RETURNS TRIGGER AS $$
    BEGIN
      IF NEW.balance < 0 THEN
        PERFORM 1 FROM blertcoin_accounts
        WHERE id = NEW.account_id
          AND kind IN ('liability', 'treasury');

        IF NOT FOUND THEN
          RAISE EXCEPTION 'NEGATIVE_BALANCE_NOT_ALLOWED'
            USING ERRCODE = 'BL104',
                  DETAIL = format('Account %s cannot have negative balance', NEW.account_id);
        END IF;
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `;

  await sql`
    CREATE TRIGGER enforce_balance_constraints
    BEFORE INSERT OR UPDATE ON blertcoin_account_balances
    FOR EACH ROW
    EXECUTE FUNCTION check_balance_by_account_type();
  `;

  await sql`
    CREATE TABLE blertcoin_transactions (
      id              BIGSERIAL PRIMARY KEY,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_by      INTEGER NOT NULL,
      created_by_svc  TEXT NOT NULL,
      reason          TEXT NOT NULL,
      source_table    TEXT,
      source_id       BIGINT,
      idempotency_key TEXT,
      reverses_txn_id BIGINT REFERENCES blertcoin_transactions(id),
      metadata        JSONB NOT NULL DEFAULT '{}'::jsonb
    );
  `;

  await sql`
    CREATE UNIQUE INDEX uix_blertcoin_transactions_idempotency
      ON blertcoin_transactions(idempotency_key)
      WHERE idempotency_key IS NOT NULL;
  `;

  await sql`
    CREATE UNIQUE INDEX uix_blertcoin_transactions_reversed_once
      ON blertcoin_transactions(reverses_txn_id)
      WHERE reverses_txn_id IS NOT NULL;
  `;

  await sql`
    CREATE INDEX idx_blertcoin_transactions_created_by ON blertcoin_transactions(created_by);
  `;
  await sql`
    CREATE INDEX idx_blertcoin_transactions_source ON blertcoin_transactions(source_table, source_id);
  `;
  await sql`
    CREATE INDEX idx_blertcoin_transactions_created_at ON blertcoin_transactions(created_at DESC);
  `;
  await sql`
    CREATE INDEX idx_blertcoin_transactions_reverses ON blertcoin_transactions(reverses_txn_id);
  `;

  await sql`
    CREATE INDEX idx_blertcoin_transactions_metadata_gin
      ON blertcoin_transactions USING GIN (metadata);
  `;

  await sql`
    CREATE TABLE blertcoin_transaction_entries (
      id         BIGSERIAL PRIMARY KEY,
      txn_id     BIGINT NOT NULL REFERENCES blertcoin_transactions(id) ON DELETE CASCADE,
      account_id BIGINT NOT NULL REFERENCES blertcoin_accounts(id),
      amount     BIGINT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;

  await sql`
    CREATE INDEX idx_blertcoin_transaction_entries_txn_id ON blertcoin_transaction_entries(txn_id);
  `;
  await sql`
    CREATE INDEX idx_blertcoin_transaction_entries_account_id ON blertcoin_transaction_entries(account_id);
  `;

  await sql`
    CREATE TYPE blertcoin_entry_input AS (
      account_id BIGINT,
      amount BIGINT
    );
  `;
}
