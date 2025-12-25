import { Request, Response } from 'express';

import { getRequestContext } from '@/context';
import {
  findAccountById,
  findSystemAccountByName,
  findUserAccountByUserId,
} from '@/core/accounts';
import {
  PostTransactionRequest,
  PostTransactionResult,
  postTransaction,
  TransactionError,
  TransactionEntry,
  TransactionSource,
} from '@/core/transactions';

import { ApiError, ApiErrorCode } from './error';

export type UserParticipant = {
  kind: 'user';
  userId: number;
  amount: number;
};

export type SystemParticipant = {
  kind: 'system';
  name: string;
  amount: number;
};

export type AccountParticipant = {
  kind: 'account';
  accountId: number;
  amount: number;
};

export type TransactionParticipant =
  | UserParticipant
  | SystemParticipant
  | AccountParticipant;

type CreateTransactionBody = {
  createdBy: number;
  reason: string;
  idempotencyKey?: string;
  source?: TransactionSource;
  metadata?: Record<string, unknown>;
  entries?: TransactionEntry[];
  participants?: TransactionParticipant[];
};

type TransactionEntryResponse = {
  accountId: number;
  amount: number;
  balanceAfter: number;
};

type UserParticipantResponse = UserParticipant & { balanceAfter: number };
type SystemParticipantResponse = SystemParticipant & { balanceAfter: number };
type AccountParticipantResponse = AccountParticipant & { balanceAfter: number };

type ParticipantResponse =
  | UserParticipantResponse
  | SystemParticipantResponse
  | AccountParticipantResponse;

type TransactionResponseBase = {
  transactionId: number;
  createdAt: string;
  idempotent: boolean;
};

type TransactionResponseWithEntries = TransactionResponseBase & {
  entries: TransactionEntryResponse[];
};

type TransactionResponseWithParticipants = TransactionResponseBase & {
  participants: ParticipantResponse[];
};

type TransactionResponse =
  | TransactionResponseWithEntries
  | TransactionResponseWithParticipants;

/**
 * Mapping from account ID to the original participant that resolved to it.
 */
type ParticipantMapping = Map<number, TransactionParticipant>;

function toTransactionResponse(
  result: PostTransactionResult,
  participantMapping?: ParticipantMapping,
): TransactionResponse {
  const base: TransactionResponseBase = {
    transactionId: result.transactionId,
    createdAt: result.createdAt.toISOString(),
    idempotent: result.idempotent,
  };

  if (participantMapping !== undefined) {
    return {
      ...base,
      participants: result.entries.map((e) => {
        const participant = participantMapping.get(e.accountId)!;
        return {
          ...participant,
          balanceAfter: e.balanceAfter,
        };
      }),
    };
  }

  return {
    ...base,
    entries: result.entries.map((e) => ({
      accountId: e.accountId,
      amount: e.delta,
      balanceAfter: e.balanceAfter,
    })),
  };
}

function mapTransactionError(err: TransactionError): ApiError {
  switch (err.code) {
    case 'INSUFFICIENT_FUNDS':
      return new ApiError(ApiErrorCode.INSUFFICIENT_FUNDS, err.message);
    case 'INVALID_AMOUNT':
      return new ApiError(ApiErrorCode.INVALID_AMOUNT, err.message);
    case 'UNBALANCED_TRANSACTION':
      return new ApiError(ApiErrorCode.UNBALANCED_TRANSACTION, err.message);
  }
}

function isParticipant(
  participant: unknown,
): participant is TransactionParticipant {
  if (
    typeof participant !== 'object' ||
    participant === null ||
    !('kind' in participant)
  ) {
    return false;
  }

  const kind = participant.kind;
  switch (kind) {
    case 'account':
      return typeof (participant as AccountParticipant).accountId === 'number';
    case 'user':
      return typeof (participant as UserParticipant).userId === 'number';
    case 'system':
      return typeof (participant as SystemParticipant).name === 'string';
    default:
      return false;
  }
}

/**
 * Resolves a participant to an account ID.
 */
async function resolveParticipant(
  participant: TransactionParticipant,
): Promise<number> {
  switch (participant.kind) {
    case 'account': {
      const account = await findAccountById(participant.accountId);
      if (account === null) {
        throw new ApiError(
          ApiErrorCode.ACCOUNT_NOT_FOUND,
          `Account ${participant.accountId} not found`,
        );
      }
      return participant.accountId;
    }

    case 'user': {
      const account = await findUserAccountByUserId(participant.userId);
      if (account === null) {
        throw new ApiError(
          ApiErrorCode.ACCOUNT_NOT_FOUND,
          `User ${participant.userId} does not have an account`,
        );
      }
      return account.id;
    }

    case 'system': {
      const account = await findSystemAccountByName(participant.name);
      if (account === null) {
        throw new ApiError(
          ApiErrorCode.ACCOUNT_NOT_FOUND,
          `System account '${participant.name}' not found`,
        );
      }
      return account.id;
    }
  }
}

type ResolvedParticipants = {
  entries: TransactionEntry[];
  mapping: ParticipantMapping;
};

/**
 * Resolves participants to transaction entries, returning both the entries
 * and a mapping from account IDs back to the original participants.
 */
async function resolveParticipants(
  participants: TransactionParticipant[],
): Promise<ResolvedParticipants> {
  const resolved = await Promise.all(
    participants.map(async (participant) => {
      const accountId = await resolveParticipant(participant);
      return { participant, entry: { accountId, amount: participant.amount } };
    }),
  );

  const entries = resolved.map((r) => r.entry);
  const mapping = new Map(
    resolved.map((r) => [r.entry.accountId, r.participant]),
  );
  return { entries, mapping };
}

export async function create(req: Request, res: Response): Promise<void> {
  const body = req.body as CreateTransactionBody;
  const { requestService: serviceName = 'unknown' } = getRequestContext();

  // Validate required fields.
  if (!Number.isInteger(body.createdBy)) {
    throw new ApiError(
      ApiErrorCode.BAD_REQUEST,
      'createdBy must be an integer',
    );
  }
  if (typeof body.reason !== 'string' || body.reason.length === 0) {
    throw new ApiError(ApiErrorCode.BAD_REQUEST, 'reason is required');
  }

  // Validate that exactly one of entries or participants is provided.
  const hasEntries = Array.isArray(body.entries) && body.entries.length > 0;
  const hasParticipants =
    Array.isArray(body.participants) && body.participants.length > 0;

  if (hasEntries && hasParticipants) {
    throw new ApiError(
      ApiErrorCode.BAD_REQUEST,
      'Provide either entries or participants, not both',
    );
  }
  if (!hasEntries && !hasParticipants) {
    throw new ApiError(
      ApiErrorCode.BAD_REQUEST,
      'Either entries or participants is required',
    );
  }

  let entries: TransactionEntry[] = [];
  let participantMapping: ParticipantMapping | undefined;

  if (hasEntries) {
    entries = body.entries!;
  } else {
    const participants = body.participants!;
    for (let i = 0; i < participants.length; i++) {
      const participant = participants[i];
      if (!isParticipant(participant)) {
        throw new ApiError(
          ApiErrorCode.BAD_REQUEST,
          `Invalid participant at index ${i}`,
        );
      }
    }
    const resolved = await resolveParticipants(participants);
    entries = resolved.entries;
    participantMapping = resolved.mapping;
  }

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (typeof entry !== 'object' || entry === null) {
      throw new ApiError(
        ApiErrorCode.BAD_REQUEST,
        `Invalid entry at index ${i}`,
      );
    }
    if (!Number.isInteger(entry.accountId)) {
      throw new ApiError(
        ApiErrorCode.BAD_REQUEST,
        'Account IDs must be integers',
      );
    }
    if (!Number.isInteger(entry.amount)) {
      throw new ApiError(
        ApiErrorCode.BAD_REQUEST,
        'Transaction amounts must be integers',
      );
    }
  }

  const request: PostTransactionRequest = {
    createdBy: body.createdBy,
    reason: body.reason,
    idempotencyKey: body.idempotencyKey,
    metadata: body.metadata,
    source: body.source,
    entries,
  };

  try {
    const result = await postTransaction(serviceName, request);
    const status = result.idempotent ? 200 : 201;
    res.status(status).json(toTransactionResponse(result, participantMapping));
  } catch (err) {
    if (err instanceof TransactionError) {
      throw mapTransactionError(err);
    }
    throw err;
  }
}
