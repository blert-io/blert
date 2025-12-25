import { Sql } from 'postgres';

import { applySqlFile } from './util';

export async function migrate(sql: Sql) {
  await sql`
    CREATE TABLE blertcoin_transaction_accounts (
      id            BIGSERIAL PRIMARY KEY,
      txn_id        BIGINT NOT NULL REFERENCES blertcoin_transactions(id) ON DELETE CASCADE,
      account_id    BIGINT NOT NULL REFERENCES blertcoin_accounts(id),
      delta         BIGINT NOT NULL,
      balance_after BIGINT NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;

  await sql`
    CREATE UNIQUE INDEX uix_blertcoin_transaction_accounts_txn_account
      ON blertcoin_transaction_accounts(txn_id, account_id);
  `;

  await sql`
    CREATE INDEX idx_blertcoin_transaction_accounts_account_id
      ON blertcoin_transaction_accounts(account_id);
  `;

  await applySqlFile(
    sql,
    'post_blertcoin_transaction/20260201-balance-snapshots.sql',
  );
}
