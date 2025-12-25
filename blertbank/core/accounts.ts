import { isPostgresUniqueViolation } from '@blert/common';
import { Sql } from 'postgres';

import sql from '@/db';

export type AccountKind = 'user' | 'treasury' | 'sink' | 'liability' | 'escrow';

export type AccountRow = {
  id: number;
  ownerUserId: number | null;
  kind: AccountKind;
  balance: number;
  createdAt: Date;
  updatedAt: Date;
};

type RawAccountRow = {
  id: number;
  owner_user_id: number | null;
  kind: AccountKind;
  balance: number;
  created_at: Date;
  updated_at: Date;
};

function rowToAccount(row: RawAccountRow): AccountRow {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    kind: row.kind,
    balance: row.balance,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Finds a user's account by their user ID.
 *
 * @param userId ID of the user whose account to fetch.
 * @param tx Optional transaction to use.
 * @returns The user's account or null if it does not exist.
 */
export async function findUserAccountByUserId(
  userId: number,
  tx: Sql = sql,
): Promise<AccountRow | null> {
  const [row] = await tx<RawAccountRow[]>`
    SELECT
      a.id,
      a.owner_user_id,
      a.kind,
      b.balance,
      a.created_at,
      b.updated_at
    FROM blertcoin_accounts a
    JOIN blertcoin_account_balances b ON b.account_id = a.id
    WHERE a.owner_user_id = ${userId} AND a.kind = 'user'
  `;

  return row ? rowToAccount(row) : null;
}

export type GetOrCreateResult = {
  account: AccountRow;
  created: boolean;
};

/**
 * Gets an existing user account or creates a new one with a balance of 0.
 *
 * @param userId ID of the user whose account to fetch.
 */
export async function getOrCreateUserAccount(
  userId: number,
): Promise<GetOrCreateResult> {
  return sql.begin(async (tx) => {
    const existing = await findUserAccountByUserId(userId, tx);
    if (existing !== null) {
      return { account: existing, created: false };
    }

    try {
      const [inserted] = await tx<{ id: number; created_at: Date }[]>`
        INSERT INTO blertcoin_accounts (owner_user_id, kind)
        VALUES (${userId}, 'user')
        RETURNING id, created_at
      `;

      await tx`
        INSERT INTO blertcoin_account_balances (account_id, balance)
        VALUES (${inserted.id}, 0)
        ON CONFLICT DO NOTHING
      `;

      return {
        account: {
          id: inserted.id,
          ownerUserId: userId,
          kind: 'user',
          balance: 0,
          createdAt: inserted.created_at,
          updatedAt: inserted.created_at,
        },
        created: true,
      };
    } catch (e) {
      // Handle race condition: another request created the account.
      if (isPostgresUniqueViolation(e)) {
        const existing = await findUserAccountByUserId(userId, tx);
        if (existing !== null) {
          return { account: existing, created: false };
        }
      }
      throw e;
    }
  });
}

/**
 * Finds a system account by its registered name.
 *
 * @param name Name of the system account to fetch.
 * @param tx Optional transaction to use.
 * @returns The system account or null if it does not exist.
 */
export async function findSystemAccountByName(
  name: string,
  tx: Sql = sql,
): Promise<AccountRow | null> {
  const [row] = await tx<RawAccountRow[]>`
    SELECT
      a.id,
      a.owner_user_id,
      a.kind,
      b.balance,
      a.created_at,
      b.updated_at
    FROM blertcoin_system_accounts sa
    JOIN blertcoin_accounts a ON a.id = sa.account_id
    JOIN blertcoin_account_balances b ON b.account_id = a.id
    WHERE sa.name = ${name}
  `;

  return row ? rowToAccount(row) : null;
}

/**
 * Finds an account by its ID.
 *
 * @param accountId ID of the account to fetch.
 * @param tx Optional transaction to use.
 * @returns The account or null if it does not exist.
 */
export async function findAccountById(
  accountId: number,
  tx: Sql = sql,
): Promise<AccountRow | null> {
  const [row] = await tx<RawAccountRow[]>`
    SELECT
      a.id,
      a.owner_user_id,
      a.kind,
      b.balance,
      a.created_at,
      b.updated_at
    FROM blertcoin_accounts a
    JOIN blertcoin_account_balances b ON b.account_id = a.id
    WHERE a.id = ${accountId}
  `;

  return row ? rowToAccount(row) : null;
}
