export enum ApiErrorCode {
  ACCOUNT_NOT_FOUND = 'ACCOUNT_NOT_FOUND',

  BAD_REQUEST = 'BAD_REQUEST',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  UNAUTHORIZED = 'UNAUTHORIZED',
}

export class ApiError extends Error {
  constructor(
    public code: ApiErrorCode = ApiErrorCode.INTERNAL_ERROR,
    message: string = 'Internal server error',
  ) {
    super(message);
  }

  /**
   * Returns the HTTP status code for an API error.
   * @param error Error for which to get the status code.
   * @returns HTTP status code.
   */
  public get statusCode(): number {
    switch (this.code) {
      case ApiErrorCode.BAD_REQUEST:
        return 400;
      case ApiErrorCode.ACCOUNT_NOT_FOUND:
        return 404;
      case ApiErrorCode.INTERNAL_ERROR:
        return 500;
      case ApiErrorCode.UNAUTHORIZED:
        return 401;
    }

    const _exhaustiveGuard: never = this.code;
    return 500;
  }
}
