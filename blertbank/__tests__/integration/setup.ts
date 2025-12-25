import { config } from 'dotenv';
import { resolve } from 'path';

// Load test environment variables before anything else.
config({ path: resolve(__dirname, '../../.env.test') });

import sql from '@/db';

/**
 * Truncates all blertcoin tables to reset state between tests.
 */
export async function truncateTables(): Promise<void> {
  await sql`
    TRUNCATE TABLE
      blertcoin_transaction_accounts,
      blertcoin_transaction_entries,
      blertcoin_transactions,
      blertcoin_account_balances,
      blertcoin_system_accounts,
      blertcoin_accounts
    RESTART IDENTITY CASCADE
  `;
}

/**
 * Seeds the system accounts (treasury, purchases sink).
 */
export async function seedSystemAccounts(): Promise<{
  treasuryId: number;
  purchasesId: number;
}> {
  const [treasury, purchases] = await sql<{ id: number }[]>`
    INSERT INTO blertcoin_accounts (owner_user_id, kind)
    VALUES
      (NULL, 'treasury'),
      (NULL, 'sink')
    RETURNING id
  `;

  await sql`
    INSERT INTO blertcoin_account_balances (account_id, balance)
    VALUES
      (${treasury.id}, 0),
      (${purchases.id}, 0)
  `;

  await sql`
    INSERT INTO blertcoin_system_accounts (name, account_id)
    VALUES
      ('treasury', ${treasury.id}),
      ('purchases', ${purchases.id})
  `;

  return { treasuryId: treasury.id, purchasesId: purchases.id };
}

/**
 * Creates a user account for testing.
 */
export async function createUserAccount(
  userId: number,
  initialBalance: number = 0,
): Promise<number> {
  const [account] = await sql<{ id: number }[]>`
    INSERT INTO blertcoin_accounts (owner_user_id, kind)
    VALUES (${userId}, 'user')
    RETURNING id
  `;

  await sql`
    INSERT INTO blertcoin_account_balances (account_id, balance)
    VALUES (${account.id}, ${initialBalance})
  `;

  return account.id;
}

/**
 * Gets the current balance for an account.
 */
export async function getBalance(accountId: number): Promise<number> {
  const [row] = await sql<{ balance: bigint }[]>`
    SELECT balance FROM blertcoin_account_balances
    WHERE account_id = ${accountId}
  `;
  return Number(row?.balance ?? 0);
}

export type StoredTransaction = {
  id: number;
  createdBy: number;
  createdBySvc: string;
  reason: string;
  sourceTable: string | null;
  sourceId: number | null;
  metadata: Record<string, unknown>;
};

/**
 * Gets a transaction by ID.
 */
export async function getTransaction(
  transactionId: number,
): Promise<StoredTransaction | null> {
  const [row] = await sql<
    {
      id: bigint;
      created_by: number;
      created_by_svc: string;
      reason: string;
      source_table: string | null;
      source_id: bigint | null;
      metadata: Record<string, unknown>;
    }[]
  >`
    SELECT id, created_by, created_by_svc, reason, source_table, source_id, metadata
    FROM blertcoin_transactions
    WHERE id = ${transactionId}
  `;
  if (!row) {
    return null;
  }
  return {
    id: Number(row.id),
    createdBy: row.created_by,
    createdBySvc: row.created_by_svc,
    reason: row.reason,
    sourceTable: row.source_table,
    sourceId: row.source_id !== null ? Number(row.source_id) : null,
    metadata: row.metadata,
  };
}

// Ensure clean state before each test file.
beforeAll(async () => {
  await truncateTables();
});

// Cleanup after all tests.
afterAll(async () => {
  await sql.end();
});
