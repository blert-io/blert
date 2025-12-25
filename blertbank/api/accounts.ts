import { Request, Response } from 'express';

import {
  AccountRow,
  findUserAccountByUserId,
  getOrCreateUserAccount,
} from '@/core/accounts';

import { ApiError, ApiErrorCode } from './error';

type UserAccountResponse = {
  accountId: number;
  kind: 'user';
  userId: number;
  balance: number;
  createdAt: Date;
  updatedAt: Date;
};

function toUserAccountResponse(account: AccountRow): UserAccountResponse {
  if (account.kind !== 'user' || account.ownerUserId === null) {
    throw new Error('Expected user account');
  }

  return {
    accountId: account.id,
    kind: 'user',
    userId: account.ownerUserId,
    balance: account.balance,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}

export async function createForUser(
  req: Request,
  res: Response,
): Promise<void> {
  const { userId } = req.body as { userId: number };
  if (!Number.isInteger(userId)) {
    throw new ApiError(ApiErrorCode.BAD_REQUEST, 'Invalid user ID');
  }

  const { account, created } = await getOrCreateUserAccount(userId);

  res.status(created ? 201 : 200).json(toUserAccountResponse(account));
}

export async function getByUserId(req: Request, res: Response): Promise<void> {
  const userId = Number.parseInt(req.params.userId, 10);
  if (!Number.isInteger(userId)) {
    throw new ApiError(ApiErrorCode.BAD_REQUEST, 'Invalid user ID');
  }

  const account = await findUserAccountByUserId(userId);
  if (account === null) {
    throw new ApiError(ApiErrorCode.ACCOUNT_NOT_FOUND, 'Account not found');
  }

  res.json(toUserAccountResponse(account));
}
