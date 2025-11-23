import { BlertbankClient } from '../client';
import {
  AccountNotFoundError,
  BlertbankApiError,
  BlertbankError,
  UnauthorizedError,
} from '../errors';
import { UserAccount, UserAccountRaw } from '../types';

describe('BlertbankClient', () => {
  let mockFetch: jest.Mock;
  let client: BlertbankClient;

  const mockAccountRaw: UserAccountRaw = {
    accountId: 123,
    kind: 'user',
    userId: 456,
    balance: 1000,
    createdAt: '2025-11-01T00:00:00Z',
    updatedAt: '2025-11-16T12:00:00Z',
  };

  const mockAccount: UserAccount = {
    ...mockAccountRaw,
    createdAt: new Date(mockAccountRaw.createdAt),
    updatedAt: new Date(mockAccountRaw.updatedAt),
  };

  beforeEach(() => {
    mockFetch = jest.fn();
    client = new BlertbankClient({
      baseUrl: 'http://localhost:3000',
      serviceToken: 'test-token',
      serviceName: 'test-service',
      fetch: mockFetch,
    });
  });

  describe('constructor', () => {
    it('should strip trailing slash from baseUrl', () => {
      const clientWithSlash = new BlertbankClient({
        baseUrl: 'http://localhost:3000/',
        serviceToken: 'test-token',
        serviceName: 'test-service',
        fetch: mockFetch,
      });

      expect(clientWithSlash).toBeDefined();
    });

    it('should throw error if service token is missing', () => {
      expect(() => {
        new BlertbankClient({
          baseUrl: 'http://localhost:3000',
          serviceToken: '',
          serviceName: 'test-service',
          fetch: mockFetch,
        });
      }).toThrow(BlertbankError);
    });
  });

  describe('getOrCreateAccountForUser', () => {
    it('should create a new account successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => mockAccountRaw,
      });

      const result = await client.getOrCreateAccountForUser(456);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/accounts',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'X-Service-Token': 'test-token',
            'X-Service-Name': 'test-service',
          }),
          body: JSON.stringify({ userId: 456 }),
        }),
      );

      expect(result).toEqual(mockAccount);
      expect(result.createdAt).toBeInstanceOf(Date);
      expect(result.updatedAt).toBeInstanceOf(Date);
    });

    it('should return existing account if already created', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockAccountRaw,
      });

      const result = await client.getOrCreateAccountForUser(456);

      expect(result).toEqual(mockAccount);
    });

    it('should handle unauthorized error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({
          error: 'UNAUTHORIZED',
          message: 'Invalid service token',
          timestamp: '2025-11-16T12:00:00Z',
        }),
      });

      await expect(client.getOrCreateAccountForUser(456)).rejects.toThrow(
        UnauthorizedError,
      );
    });

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(client.getOrCreateAccountForUser(456)).rejects.toThrow(
        BlertbankError,
      );
    });
  });

  describe('getAccountByUserId', () => {
    it('should get account details successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockAccountRaw,
      });

      const result = await client.getAccountByUserId(456);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/accounts/user/456',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'X-Service-Token': 'test-token',
            'X-Service-Name': 'test-service',
          }),
        }),
      );

      expect(result).toEqual(mockAccount);
    });

    it('should throw AccountNotFoundError when account does not exist', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({
          error: 'ACCOUNT_NOT_FOUND',
          message: 'Account not found',
          timestamp: '2025-11-16T12:00:00Z',
        }),
      });

      await expect(client.getAccountByUserId(456)).rejects.toThrow(
        AccountNotFoundError,
      );
    });
  });

  describe('getBalance', () => {
    it('should get balance successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockAccountRaw,
      });

      const balance = await client.getBalance(456);

      expect(balance).toBe(1000);
    });

    it('should throw AccountNotFoundError when account does not exist', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({
          error: 'ACCOUNT_NOT_FOUND',
          message: 'Account not found',
          timestamp: '2025-11-16T12:00:00Z',
        }),
      });

      await expect(client.getBalance(456)).rejects.toThrow(
        AccountNotFoundError,
      );
    });
  });

  describe('getOrCreateBalance', () => {
    it('should get balance for existing account', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockAccountRaw,
      });

      const balance = await client.getOrCreateBalance(456);

      expect(balance).toBe(1000);
    });

    it('should create account and return 0 balance for new user', async () => {
      const newAccount = {
        ...mockAccountRaw,
        balance: 0,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => newAccount,
      });

      const balance = await client.getOrCreateBalance(456);

      expect(balance).toBe(0);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/accounts',
        expect.objectContaining({
          method: 'POST',
        }),
      );
    });
  });

  describe('ping', () => {
    it('should return true when service is healthy', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
      });

      const result = await client.ping();

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith('http://localhost:3000/ping');
    });

    it('should return false when service is unhealthy', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const result = await client.ping();

      expect(result).toBe(false);
    });

    it('should return false on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await client.ping();

      expect(result).toBe(false);
    });
  });

  describe('error handling', () => {
    it('should handle API errors with details', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          error: 'BAD_REQUEST',
          message: 'Invalid user ID',
          details: { userId: 'must be a number' },
          timestamp: '2025-11-16T12:00:00Z',
        }),
      });

      try {
        await client.getAccountByUserId(456);
        fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeInstanceOf(BlertbankApiError);
        const apiError = error as BlertbankApiError;
        expect(apiError.statusCode).toBe(400);
        expect(apiError.errorCode).toBe('BAD_REQUEST');
        expect(apiError.details).toEqual({ userId: 'must be a number' });
      }
    });

    it('should handle non-JSON error responses', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => {
          throw new Error('Invalid JSON');
        },
      });

      await expect(client.getAccountByUserId(456)).rejects.toThrow(
        BlertbankApiError,
      );
    });

    it('should include correct headers in all requests', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockAccountRaw,
      });

      await client.getAccountByUserId(456);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'X-Service-Token': 'test-token',
            'X-Service-Name': 'test-service',
            'X-Request-ID': expect.any(String),
          }),
        }),
      );
    });
  });

  describe('request ID handling', () => {
    it('should generate a UUID request ID by default', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockAccountRaw,
      });

      await client.getAccountByUserId(456);

      const headers = mockFetch.mock.calls[0][1].headers as Record<
        string,
        string
      >;
      expect(headers['X-Request-ID']).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    });

    it('should use request ID from provider', async () => {
      const clientWithProvider = new BlertbankClient({
        baseUrl: 'http://localhost:3000',
        serviceToken: 'test-token',
        serviceName: 'test-service',
        fetch: mockFetch,
        requestIdProvider: () => 'provider-request-id',
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockAccountRaw,
      });

      await clientWithProvider.getAccountByUserId(456);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Request-ID': 'provider-request-id',
          }),
        }),
      );
    });

    it('should use per-request requestId over provider', async () => {
      const clientWithProvider = new BlertbankClient({
        baseUrl: 'http://localhost:3000',
        serviceToken: 'test-token',
        serviceName: 'test-service',
        fetch: mockFetch,
        requestIdProvider: () => 'provider-request-id',
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockAccountRaw,
      });

      await clientWithProvider.getAccountByUserId(456, {
        requestId: 'per-request-id',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Request-ID': 'per-request-id',
          }),
        }),
      );
    });

    it('should generate UUID when provider returns undefined', async () => {
      const clientWithProvider = new BlertbankClient({
        baseUrl: 'http://localhost:3000',
        serviceToken: 'test-token',
        serviceName: 'test-service',
        fetch: mockFetch,
        requestIdProvider: () => undefined,
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockAccountRaw,
      });

      await clientWithProvider.getAccountByUserId(456);

      const headers = mockFetch.mock.calls[0][1].headers as Record<
        string,
        string
      >;
      expect(headers['X-Request-ID']).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    });
  });
});
