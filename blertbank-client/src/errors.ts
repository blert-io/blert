import type { ApiErrorResponse, BlertbankApiErrorCode } from './types';

/**
 * Base error class for Blertbank client errors.
 */
export class BlertbankError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlertbankError';
  }
}

/**
 * Error thrown when an API request fails.
 */
export class BlertbankApiError extends BlertbankError {
  constructor(
    public readonly statusCode: number,
    public readonly errorCode: BlertbankApiErrorCode | 'UNKNOWN_ERROR',
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'BlertbankApiError';
  }

  static fromResponse(
    statusCode: number,
    response: ApiErrorResponse,
  ): BlertbankApiError {
    return new BlertbankApiError(
      statusCode,
      response.error,
      response.message,
      response.details,
    );
  }
}

/**
 * Error thrown when account is not found.
 */
export class AccountNotFoundError extends BlertbankApiError {
  constructor(userId: number) {
    super(404, 'ACCOUNT_NOT_FOUND', `Account not found for user ${userId}`);
    this.name = 'AccountNotFoundError';
  }
}

/**
 * Error thrown when authentication fails.
 */
export class UnauthorizedError extends BlertbankApiError {
  constructor(message: string = 'Unauthorized service request') {
    super(401, 'UNAUTHORIZED', message);
    this.name = 'UnauthorizedError';
  }
}

/**
 * Error thrown when an account has insufficient funds for a transaction.
 */
export class InsufficientFundsError extends BlertbankApiError {
  constructor(message: string = 'Account has insufficient funds') {
    super(422, 'INSUFFICIENT_FUNDS', message);
    this.name = 'InsufficientFundsError';
  }
}

/**
 * Error thrown when a transaction amount is invalid (e.g., zero).
 */
export class InvalidAmountError extends BlertbankApiError {
  constructor(message: string = 'Invalid transaction amount') {
    super(400, 'INVALID_AMOUNT', message);
    this.name = 'InvalidAmountError';
  }
}

/**
 * Error thrown when transaction entries don't sum to zero.
 */
export class UnbalancedTransactionError extends BlertbankApiError {
  constructor(message: string = 'Transaction entries do not sum to zero') {
    super(400, 'UNBALANCED_TRANSACTION', message);
    this.name = 'UnbalancedTransactionError';
  }
}
