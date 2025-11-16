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

export type BlertbankApiErrorCode =
  | 'ACCOUNT_NOT_FOUND'
  | 'BAD_REQUEST'
  | 'INTERNAL_ERROR'
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
