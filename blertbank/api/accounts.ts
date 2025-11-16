import { isPostgresUniqueViolation } from '@blert/common';
import { Request, Response } from 'express';

import sql from '../db';
import { ApiError, ApiErrorCode } from './error';
import { Sql } from 'postgres';

type AccountResponse = {
  accountId: number;
  kind: 'user';
  userId: number;
  balance: number;
  createdAt: Date;
  updatedAt: Date;
};

export async function createForUser(
  req: Request,
  res: Response,
): Promise<void> {
  const { userId } = req.body as { userId: number };
  if (!Number.isInteger(userId)) {
    throw new ApiError(ApiErrorCode.BAD_REQUEST, 'Invalid user ID');
  }

  const { account, created } = await sql.begin(async (tx) => {
    const existing = await getAccountByUserId(tx, userId);
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
          accountId: inserted.id,
          kind: 'user',
          userId,
          balance: 0,
          createdAt: inserted.created_at,
          updatedAt: inserted.created_at,
        },
        created: true,
      };
    } catch (e) {
      if (isPostgresUniqueViolation(e)) {
        const existing = await getAccountByUserId(tx, userId);
        if (existing === null) {
          // Shouldn't happen but return a generic error just in case.
          throw new ApiError(
            ApiErrorCode.INTERNAL_ERROR,
            'Error retrieving account',
          );
        }
        return { account: existing, created: false };
      }

      throw e;
    }
  });

  res.status(created ? 201 : 200).json(account);
}

export async function getByUserId(req: Request, res: Response): Promise<void> {
  const userId = Number.parseInt(req.params.userId, 10);
  if (!Number.isInteger(userId)) {
    throw new ApiError(ApiErrorCode.BAD_REQUEST, 'Invalid user ID');
  }

  const account = await getAccountByUserId(sql, userId);
  if (account === null) {
    throw new ApiError(ApiErrorCode.ACCOUNT_NOT_FOUND, 'Account not found');
  }

  res.json(account);
}

async function getAccountByUserId(
  tx: Sql,
  userId: number,
): Promise<AccountResponse | null> {
  const [accountRow] = await tx<
    {
      id: number;
      owner_user_id: number;
      balance: number;
      created_at: Date;
      updated_at: Date;
    }[]
  >`
    SELECT
      a.id,
      a.owner_user_id,
      b.balance,
      a.created_at,
      b.updated_at
    FROM blertcoin_accounts a
    JOIN blertcoin_account_balances b ON b.account_id = a.id
    WHERE a.owner_user_id = ${userId} AND a.kind = 'user'
  `;
  if (!accountRow) {
    return null;
  }

  return {
    accountId: accountRow.id,
    kind: 'user',
    userId: accountRow.owner_user_id,
    balance: accountRow.balance,
    createdAt: accountRow.created_at,
    updatedAt: accountRow.updated_at,
  };
}
