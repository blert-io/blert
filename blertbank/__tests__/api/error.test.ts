import { ApiError, ApiErrorCode } from '@/api/error';

describe('ApiError', () => {
  it('maps codes to status codes', () => {
    expect(new ApiError(ApiErrorCode.BAD_REQUEST).statusCode).toBe(400);
    expect(new ApiError(ApiErrorCode.ACCOUNT_NOT_FOUND).statusCode).toBe(404);
    expect(new ApiError(ApiErrorCode.UNAUTHORIZED).statusCode).toBe(401);
    expect(new ApiError(ApiErrorCode.INTERNAL_ERROR).statusCode).toBe(500);
  });
});
