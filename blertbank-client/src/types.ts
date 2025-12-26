type WithDateString<T> = {
  [K in keyof T]: T[K] extends Date ? string : T[K];
};

/**
 * User account information.
 */
export type UserAccount = {
  accountId: number;
  kind: 'user';
  userId: number;
  balance: number;
  createdAt: Date;
  updatedAt: Date;
};

export type UserAccountRaw = WithDateString<UserAccount>;

// Transaction types

/**
 * A participant identified by user ID.
 */
export type UserParticipant = {
  kind: 'user';
  userId: number;
  amount: number;
};

/**
 * A participant identified by system account name.
 */
export type SystemParticipant = {
  kind: 'system';
  name: string;
  amount: number;
};

/**
 * A participant identified by account ID.
 */
export type AccountParticipant = {
  kind: 'account';
  accountId: number;
  amount: number;
};

/**
 * A participant in a transaction.
 */
export type TransactionParticipant =
  | UserParticipant
  | SystemParticipant
  | AccountParticipant;

/**
 * A raw entry in a transaction, specifying account ID and amount directly.
 */
export type TransactionEntry = {
  accountId: number;
  amount: number;
};

/**
 * Source of a transaction, linking it to a database record.
 */
export type TransactionSource = {
  table: string;
  id: number;
};

type BaseCreateTransactionRequest = {
  /** The ID of the user or system actor (0) that created the transaction. */
  createdBy: number;
  /** Reason for the transaction. */
  reason: string;
  /** Optional idempotency key to prevent duplicate transactions. */
  idempotencyKey?: string;
  /** Optional source linking this transaction to a database record. */
  source?: TransactionSource;
  /** Optional metadata to attach to the transaction. */
  metadata?: Record<string, unknown>;
};

/**
 * Request to create a transaction using participants.
 */
export type CreateTransactionWithParticipantsRequest =
  BaseCreateTransactionRequest & {
    /** Participants in the transaction. */
    participants: TransactionParticipant[];
  };

/**
 * Request to create a transaction using raw entries.
 */
export type CreateTransactionWithEntriesRequest =
  BaseCreateTransactionRequest & {
    /** Raw entries in the transaction. */
    entries: TransactionEntry[];
  };

/**
 * Request to create a transaction.
 */
export type CreateTransactionRequest =
  | CreateTransactionWithParticipantsRequest
  | CreateTransactionWithEntriesRequest;

/**
 * Entry in a transaction result.
 */
export type TransactionResultEntry = {
  accountId: number;
  amount: number;
  balanceAfter: number;
};

/**
 * Response participant types.
 */
export type UserParticipantResponse = UserParticipant & {
  balanceAfter: number;
};
export type SystemParticipantResponse = SystemParticipant & {
  balanceAfter: number;
};
export type AccountParticipantResponse = AccountParticipant & {
  balanceAfter: number;
};

export type TransactionParticipantResponse =
  | UserParticipantResponse
  | SystemParticipantResponse
  | AccountParticipantResponse;

/**
 * Base result of creating a transaction.
 */
type TransactionResultBase = {
  transactionId: number;
  createdAt: Date;
  idempotent: boolean;
};

/**
 * Result of creating a transaction with entries.
 */
export type TransactionResultWithEntries = TransactionResultBase & {
  entries: TransactionResultEntry[];
};

/**
 * Result of creating a transaction with participants.
 */
export type TransactionResultWithParticipants = TransactionResultBase & {
  participants: TransactionParticipantResponse[];
};

/**
 * Result of creating a transaction.
 */
export type TransactionResult =
  | TransactionResultWithEntries
  | TransactionResultWithParticipants;

type TransactionResultBaseRaw = WithDateString<TransactionResultBase>;

export type TransactionResultWithEntriesRaw = TransactionResultBaseRaw & {
  entries: TransactionResultEntry[];
};

export type TransactionResultWithParticipantsRaw = TransactionResultBaseRaw & {
  participants: TransactionParticipantResponse[];
};

export type TransactionResultRaw =
  | TransactionResultWithEntriesRaw
  | TransactionResultWithParticipantsRaw;

export type BlertbankApiErrorCode =
  | 'ACCOUNT_NOT_FOUND'
  | 'BAD_REQUEST'
  | 'INSUFFICIENT_FUNDS'
  | 'INVALID_AMOUNT'
  | 'INTERNAL_ERROR'
  | 'UNBALANCED_TRANSACTION'
  | 'UNAUTHORIZED';

/**
 * API error response from Blertbank.
 */
export type ApiErrorResponse = {
  error: BlertbankApiErrorCode;
  message: string;
  details?: Record<string, unknown>;
  timestamp: string;
};
