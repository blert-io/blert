/* eslint-disable @typescript-eslint/unbound-method */

import { getUserBalance, getUserAccount } from '@/actions/blertbank';
import {
  BlertbankClient,
  BlertbankError,
  UnauthorizedError,
} from '@blert/blertbank-client';
import { getSignedInUserId } from '@/actions/users';

jest.mock('@/actions/users', () => ({
  getSignedInUserId: jest.fn(),
}));

jest.mock('@blert/blertbank-client', () => {
  return {
    BlertbankClient: jest.fn(),
    BlertbankError: class BlertbankError extends Error {
      constructor(message: string) {
        super(message);
        this.name = 'BlertbankError';
      }
    },
    UnauthorizedError: class UnauthorizedError extends Error {
      constructor(message: string) {
        super(message);
        this.name = 'UnauthorizedError';
      }
    },
  };
});

const mockGetSignedInUserId = getSignedInUserId as jest.MockedFunction<
  typeof getSignedInUserId
>;
const MockedBlertbankClient = BlertbankClient as jest.MockedClass<
  typeof BlertbankClient
>;

describe('Blertbank actions', () => {
  let mockClient: jest.Mocked<BlertbankClient>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockClient = {
      getOrCreateBalance: jest.fn(),
      getOrCreateAccountForUser: jest.fn(),
      getAccountByUserId: jest.fn(),
      getBalance: jest.fn(),
      ping: jest.fn(),
    } as any;

    MockedBlertbankClient.mockImplementation(() => mockClient);

    process.env.BLERTBANK_BASE_URL = 'http://localhost:3013';
    process.env.BLERTBANK_SERVICE_TOKEN = 'test-token';
  });

  afterEach(() => {
    delete process.env.BLERTBANK_BASE_URL;
    delete process.env.BLERTBANK_SERVICE_TOKEN;
  });

  describe('getUserBalance', () => {
    it('should return balance for authenticated user', async () => {
      mockGetSignedInUserId.mockResolvedValue(123);

      mockClient.getOrCreateBalance.mockResolvedValue(5000);

      const balance = await getUserBalance();

      expect(balance).toBe(5000);
      expect(mockClient.getOrCreateBalance).toHaveBeenCalledWith(123);
    });

    it('should create account and return 0 balance for new user', async () => {
      mockGetSignedInUserId.mockResolvedValue(456);

      mockClient.getOrCreateBalance.mockResolvedValue(0);

      const balance = await getUserBalance();

      expect(balance).toBe(0);
      expect(mockClient.getOrCreateBalance).toHaveBeenCalledWith(456);
    });

    it('should throw error when user is not authenticated', async () => {
      mockGetSignedInUserId.mockResolvedValue(null);

      await expect(getUserBalance()).rejects.toThrow('Not authenticated');
      expect(mockClient.getOrCreateBalance).not.toHaveBeenCalled();
    });

    it('should throw error when BLERTBANK_BASE_URL is not configured', async () => {
      delete process.env.BLERTBANK_BASE_URL;

      mockGetSignedInUserId.mockResolvedValue(123);

      await expect(getUserBalance()).rejects.toThrow(
        'BLERTBANK_BASE_URL is not configured',
      );
      expect(mockClient.getOrCreateBalance).not.toHaveBeenCalled();
    });

    it('should throw error when BLERTBANK_SERVICE_TOKEN is not configured', async () => {
      delete process.env.BLERTBANK_SERVICE_TOKEN;

      mockGetSignedInUserId.mockResolvedValue(123);

      await expect(getUserBalance()).rejects.toThrow(
        'BLERTBANK_SERVICE_TOKEN is not configured',
      );
      expect(mockClient.getOrCreateBalance).not.toHaveBeenCalled();
    });

    it('should throw error when service token is unauthorized', async () => {
      mockGetSignedInUserId.mockResolvedValue(123);

      mockClient.getOrCreateBalance.mockRejectedValue(
        new UnauthorizedError('Invalid service token'),
      );

      await expect(getUserBalance()).rejects.toThrow(
        'Service configuration error',
      );
    });

    it('should return 0 when Blertbank service is unavailable', async () => {
      mockGetSignedInUserId.mockResolvedValue(123);

      mockClient.getOrCreateBalance.mockRejectedValue(
        new BlertbankError('Service unavailable'),
      );

      const balance = await getUserBalance();

      expect(balance).toBe(0);
    });

    it('should return 0 when network error occurs', async () => {
      mockGetSignedInUserId.mockResolvedValue(123);

      mockClient.getOrCreateBalance.mockRejectedValue(
        new Error('Network error'),
      );

      const balance = await getUserBalance();

      expect(balance).toBe(0);
    });

    it('should initialize BlertbankClient with correct config', async () => {
      mockGetSignedInUserId.mockResolvedValue(123);

      mockClient.getOrCreateBalance.mockResolvedValue(1000);

      await getUserBalance();

      expect(MockedBlertbankClient).toHaveBeenCalledWith({
        baseUrl: 'http://localhost:3013',
        serviceToken: 'test-token',
        serviceName: 'web-app',
      });
    });
  });

  describe('getUserAccount', () => {
    const mockAccount = {
      accountId: 789,
      kind: 'user' as const,
      userId: 123,
      balance: 5000,
      createdAt: new Date('2025-01-01'),
      updatedAt: new Date('2025-01-20'),
    };

    it('should return account for authenticated user', async () => {
      mockGetSignedInUserId.mockResolvedValue(123);

      mockClient.getOrCreateAccountForUser.mockResolvedValue(mockAccount);

      const account = await getUserAccount();

      expect(account).toEqual(mockAccount);
      expect(mockClient.getOrCreateAccountForUser).toHaveBeenCalledWith(123);
    });

    it('should create and return new account for first-time user', async () => {
      const newAccount = {
        ...mockAccount,
        balance: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockGetSignedInUserId.mockResolvedValue(456);

      mockClient.getOrCreateAccountForUser.mockResolvedValue(newAccount);

      const account = await getUserAccount();

      expect(account).toEqual(newAccount);
      expect(account?.balance).toBe(0);
    });

    it('should throw error when user is not authenticated', async () => {
      mockGetSignedInUserId.mockResolvedValue(null);

      await expect(getUserAccount()).rejects.toThrow('Not authenticated');
      expect(mockClient.getOrCreateAccountForUser).not.toHaveBeenCalled();
    });

    it('should throw error when service token is unauthorized', async () => {
      mockGetSignedInUserId.mockResolvedValue(123);

      mockClient.getOrCreateAccountForUser.mockRejectedValue(
        new UnauthorizedError('Invalid service token'),
      );

      await expect(getUserAccount()).rejects.toThrow(
        'Service configuration error',
      );
    });

    it('should return null when Blertbank service is unavailable', async () => {
      mockGetSignedInUserId.mockResolvedValue(123);

      mockClient.getOrCreateAccountForUser.mockRejectedValue(
        new BlertbankError('Service unavailable'),
      );

      const account = await getUserAccount();

      expect(account).toBeNull();
    });

    it('should return null when network error occurs', async () => {
      mockGetSignedInUserId.mockResolvedValue(123);

      mockClient.getOrCreateAccountForUser.mockRejectedValue(
        new Error('Network error'),
      );

      const account = await getUserAccount();

      expect(account).toBeNull();
    });

    it('should handle large balance values correctly', async () => {
      const largeBalanceAccount = {
        ...mockAccount,
        balance: 9999999,
      };

      mockGetSignedInUserId.mockResolvedValue(123);

      mockClient.getOrCreateAccountForUser.mockResolvedValue(
        largeBalanceAccount,
      );

      const account = await getUserAccount();

      expect(account?.balance).toBe(9999999);
    });
  });

  describe('error handling and logging', () => {
    let consoleErrorSpy: jest.SpyInstance;

    beforeEach(() => {
      consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    });

    afterEach(() => {
      consoleErrorSpy.mockRestore();
    });

    it('should log BlertbankError details', async () => {
      mockGetSignedInUserId.mockResolvedValue(123);

      const error = new BlertbankError('Service unavailable');
      mockClient.getOrCreateBalance.mockRejectedValue(error);

      await getUserBalance();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to fetch balance for user',
        123,
        error,
      );
    });

    it('should log UnauthorizedError details', async () => {
      mockGetSignedInUserId.mockResolvedValue(123);

      const error = new UnauthorizedError('Invalid token');
      mockClient.getOrCreateBalance.mockRejectedValue(error);

      await expect(getUserBalance()).rejects.toThrow(
        'Service configuration error',
      );

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Blertbank authorization failed:',
        error,
      );
    });

    it('should log unexpected errors', async () => {
      mockGetSignedInUserId.mockResolvedValue(123);

      const error = new Error('Unexpected error');
      mockClient.getOrCreateBalance.mockRejectedValue(error);

      await getUserBalance();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Unexpected error fetching balance:',
        error,
      );
    });
  });
});
