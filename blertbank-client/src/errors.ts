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
