import { isPostgresError } from '@blert/common';
import { JSONValue } from 'postgres';

import sql from '@/db';
import logger from '@/log';

export type TransactionEntry = {
  accountId: number;
  amount: number;
};

/**
 * Source of a transaction, expressed as a database table and record ID.
 * For example, a transaction related to a challenge would have a source
 * of 'challenges' and the challenge ID.
 */
export type TransactionSource = {
  /** Database table to which the transaction is related. */
  table: string;
  /** ID of the record in the database table. */
  id: number;
};

export type PostTransactionRequest = {
  /** The ID of the user or system actor (0) that created the transaction. */
  createdBy: number;
  /** Reason for the transaction. */
  reason: string;
  /** Optional idempotency key to prevent duplicate transactions. */
  idempotencyKey?: string;
  /** Optional source of the transaction. */
  source?: TransactionSource;
  /** Optional metadata to attach to the transaction. */
  metadata?: Record<string, unknown>;
  /** Entries in the transaction. */
  entries: TransactionEntry[];
};

export type TransactionResultEntry = {
  accountId: number;
  delta: number;
  balanceAfter: number;
};

export type PostTransactionResult = {
  transactionId: number;
  createdAt: Date;
  entries: TransactionResultEntry[];
  idempotent: boolean;
};

export class TransactionError extends Error {
  constructor(
    public code:
      | 'UNBALANCED_TRANSACTION'
      | 'INVALID_AMOUNT'
      | 'INSUFFICIENT_FUNDS',
    message: string,
  ) {
    super(message);
  }
}

// Postgres error codes from the stored procedure.
const PG_ERROR_UNBALANCED = 'BL101';
const PG_ERROR_INVALID_AMOUNT = 'BL102';
const PG_ERROR_INSUFFICIENT_FUNDS = 'BL103';
const PG_ERROR_MISSING_SNAPSHOT = 'BL104';

/**
 * Posts a transaction to the ledger.
 *
 * @param serviceName Name of the service posting the transaction.
 * @param request Transaction details.
 * @returns Result with transaction ID and updated balances.
 */
export async function postTransaction(
  serviceName: string,
  request: PostTransactionRequest,
): Promise<PostTransactionResult> {
  // Format entries for the stored procedure.
  const entriesParam = request.entries.map(
    (e) => `(${e.accountId},${e.amount})`,
  );

  try {
    const rows = await sql<
      {
        transaction_id: bigint;
        created_at: Date;
        account_id: bigint;
        delta: bigint;
        balance_after: bigint;
        idempotent: boolean;
      }[]
    >`
      SELECT * FROM post_blertcoin_transaction(
        ${request.createdBy},
        ${serviceName},
        ${request.reason},
        ${request.idempotencyKey ?? null},
        ${request.source?.table ?? null},
        ${request.source?.id ?? null},
        ${sql.json((request.metadata ?? {}) as JSONValue)},
        ${sql.array(entriesParam)}::blertcoin_entry_input[]
      )
    `;

    if (rows.length === 0) {
      throw new Error('No rows returned from post_blertcoin_transaction');
    }

    return {
      transactionId: Number(rows[0].transaction_id),
      createdAt: rows[0].created_at,
      entries: rows.map((row) => ({
        accountId: Number(row.account_id),
        delta: Number(row.delta),
        balanceAfter: Number(row.balance_after),
      })),
      idempotent: rows[0].idempotent,
    };
  } catch (e: unknown) {
    if (isPostgresError(e)) {
      switch (e.code) {
        case PG_ERROR_UNBALANCED:
          throw new TransactionError(
            'UNBALANCED_TRANSACTION',
            'Transaction entries do not sum to zero',
          );
        case PG_ERROR_INVALID_AMOUNT:
          throw new TransactionError(
            'INVALID_AMOUNT',
            'Zero-amount entries are not allowed',
          );
        case PG_ERROR_INSUFFICIENT_FUNDS:
          throw new TransactionError(
            'INSUFFICIENT_FUNDS',
            'Account has insufficient funds',
          );
        case PG_ERROR_MISSING_SNAPSHOT:
          logger.error('blertcoin_missing_snapshot', {
            event: 'blertcoin_missing_snapshot',
            serviceName,
            createdBy: request.createdBy,
            reason: request.reason,
            idempotencyKey: request.idempotencyKey ?? null,
            sourceTable: request.source?.table ?? null,
            sourceId: request.source?.id ?? null,
            entries: request.entries,
          });
          throw new Error('Internal error posting transaction');
      }
    }
    throw e;
  }
}
