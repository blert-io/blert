import {
  AccountNotFoundError,
  BlertbankApiError,
  BlertbankError,
  UnauthorizedError,
} from '../errors';
import type { ApiErrorResponse } from '../types';

describe('Error classes', () => {
  describe('BlertbankError', () => {
    it('should create error with message', () => {
      const error = new BlertbankError('Test error');

      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('BlertbankError');
      expect(error.message).toBe('Test error');
    });
  });

  describe('BlertbankApiError', () => {
    it('should create error with all properties', () => {
      const error = new BlertbankApiError(
        400,
        'BAD_REQUEST',
        'Invalid request',
        { field: 'userId' },
      );

      expect(error).toBeInstanceOf(BlertbankError);
      expect(error.name).toBe('BlertbankApiError');
      expect(error.statusCode).toBe(400);
      expect(error.errorCode).toBe('BAD_REQUEST');
      expect(error.message).toBe('Invalid request');
      expect(error.details).toEqual({ field: 'userId' });
    });

    it('should create error from API response', () => {
      const response: ApiErrorResponse = {
        error: 'INTERNAL_ERROR',
        message: 'Something went wrong',
        details: { reason: 'database connection failed' },
        timestamp: '2025-11-16T12:00:00Z',
      };

      const error = BlertbankApiError.fromResponse(500, response);

      expect(error.statusCode).toBe(500);
      expect(error.errorCode).toBe('INTERNAL_ERROR');
      expect(error.message).toBe('Something went wrong');
      expect(error.details).toEqual({ reason: 'database connection failed' });
    });

    it('should handle response without details', () => {
      const response: ApiErrorResponse = {
        error: 'ACCOUNT_NOT_FOUND',
        message: 'Resource not found',
        timestamp: '2025-11-16T12:00:00Z',
      };

      const error = BlertbankApiError.fromResponse(404, response);

      expect(error.details).toBeUndefined();
    });
  });

  describe('AccountNotFoundError', () => {
    it('should create error with userId', () => {
      const error = new AccountNotFoundError(123);

      expect(error).toBeInstanceOf(BlertbankApiError);
      expect(error.name).toBe('AccountNotFoundError');
      expect(error.statusCode).toBe(404);
      expect(error.errorCode).toBe('ACCOUNT_NOT_FOUND');
      expect(error.message).toBe('Account not found for user 123');
    });
  });

  describe('UnauthorizedError', () => {
    it('should create error with default message', () => {
      const error = new UnauthorizedError();

      expect(error).toBeInstanceOf(BlertbankApiError);
      expect(error.name).toBe('UnauthorizedError');
      expect(error.statusCode).toBe(401);
      expect(error.errorCode).toBe('UNAUTHORIZED');
      expect(error.message).toBe('Unauthorized service request');
    });

    it('should create error with custom message', () => {
      const error = new UnauthorizedError('Invalid token');

      expect(error.message).toBe('Invalid token');
    });
  });

  describe('Error inheritance', () => {
    it('should maintain proper error hierarchy', () => {
      const accountError = new AccountNotFoundError(123);

      expect(accountError instanceof Error).toBe(true);
      expect(accountError instanceof BlertbankError).toBe(true);
      expect(accountError instanceof BlertbankApiError).toBe(true);
      expect(accountError instanceof AccountNotFoundError).toBe(true);
    });

    it('should allow catching by base class', () => {
      const errors = [
        new BlertbankError('Generic error'),
        new BlertbankApiError(400, 'BAD_REQUEST', 'Bad request'),
        new AccountNotFoundError(123),
        new UnauthorizedError(),
      ];

      errors.forEach((error) => {
        expect(error instanceof BlertbankError).toBe(true);
      });
    });
  });
});
