process.env.BLERTBANK_SERVICE_TOKEN = 'test-token';
process.env.BLERTBANK_DATABASE_URI = 'postgres://test:test@localhost:5432/test';

import request from 'supertest';

jest.mock('@/db');
jest.mock('@/core/accounts');
jest.mock('@/core/transactions', () => {
  const actual = jest.requireActual('@/core/transactions');
  return {
    ...actual,
    postTransaction: jest.fn(),
  };
});

import { createApp } from '@/app';
import * as accountsCore from '@/core/accounts';
import * as transactionsCore from '@/core/transactions';

const mockedAccounts = jest.mocked(accountsCore);
const mockedPostTransaction =
  transactionsCore.postTransaction as jest.MockedFunction<
    typeof transactionsCore.postTransaction
  >;

describe('POST /transactions', () => {
  const app = createApp();

  beforeEach(() => {
    jest.resetAllMocks();
  });

  describe('participant resolution', () => {
    it('resolves user participants to account IDs', async () => {
      mockedAccounts.findUserAccountByUserId.mockResolvedValue({
        id: 10,
        ownerUserId: 456,
        kind: 'user',
        balance: 500,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      mockedAccounts.findSystemAccountByName.mockResolvedValue({
        id: 1,
        ownerUserId: null,
        kind: 'treasury',
        balance: 1000000,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      mockedPostTransaction.mockResolvedValue({
        transactionId: 123,
        createdAt: new Date('2025-01-01T00:00:00Z'),
        entries: [
          { accountId: 1, delta: -100, balanceAfter: 999900 },
          { accountId: 10, delta: 100, balanceAfter: 600 },
        ],
        idempotent: false,
      });

      const res = await request(app)
        .post('/transactions')
        .set('X-Service-Token', 'test-token')
        .set('X-Service-Name', 'test-service')
        .send({
          createdBy: 1,
          reason: 'test_transfer',
          participants: [
            { kind: 'system', name: 'treasury', amount: -100 },
            { kind: 'user', userId: 456, amount: 100 },
          ],
        });

      expect(res.status).toBe(201);
      expect(mockedAccounts.findUserAccountByUserId).toHaveBeenCalledWith(456);
      expect(mockedAccounts.findSystemAccountByName).toHaveBeenCalledWith(
        'treasury',
      );
      expect(mockedPostTransaction).toHaveBeenCalledWith(
        'test-service',
        expect.objectContaining({
          entries: [
            { accountId: 1, amount: -100 },
            { accountId: 10, amount: 100 },
          ],
        }),
      );
    });

    it('resolves account participants directly', async () => {
      mockedAccounts.findAccountById.mockResolvedValue({
        id: 5,
        ownerUserId: null,
        kind: 'sink',
        balance: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      mockedAccounts.findSystemAccountByName.mockResolvedValue({
        id: 1,
        ownerUserId: null,
        kind: 'treasury',
        balance: 1000000,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      mockedPostTransaction.mockResolvedValue({
        transactionId: 124,
        createdAt: new Date('2025-01-01T00:00:00Z'),
        entries: [
          { accountId: 1, delta: -50, balanceAfter: 999950 },
          { accountId: 5, delta: 50, balanceAfter: 50 },
        ],
        idempotent: false,
      });

      const res = await request(app)
        .post('/transactions')
        .set('X-Service-Token', 'test-token')
        .send({
          createdBy: 1,
          reason: 'direct_transfer',
          participants: [
            { kind: 'system', name: 'treasury', amount: -50 },
            { kind: 'account', accountId: 5, amount: 50 },
          ],
        });

      expect(res.status).toBe(201);
      expect(mockedAccounts.findAccountById).toHaveBeenCalledWith(5);
      expect(mockedPostTransaction).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          entries: [
            { accountId: 1, amount: -50 },
            { accountId: 5, amount: 50 },
          ],
        }),
      );
    });

    it('returns 404 when user account not found', async () => {
      mockedAccounts.findUserAccountByUserId.mockResolvedValue(null);
      mockedAccounts.findSystemAccountByName.mockResolvedValue({
        id: 1,
        ownerUserId: null,
        kind: 'treasury',
        balance: 1000000,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await request(app)
        .post('/transactions')
        .set('X-Service-Token', 'test-token')
        .send({
          createdBy: 1,
          reason: 'test',
          participants: [
            { kind: 'system', name: 'treasury', amount: -100 },
            { kind: 'user', userId: 999, amount: 100 },
          ],
        });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('ACCOUNT_NOT_FOUND');
      expect(res.body.message).toContain('999');
      expect(mockedPostTransaction).not.toHaveBeenCalled();
    });

    it('returns 404 when system account not found', async () => {
      mockedAccounts.findSystemAccountByName.mockResolvedValue(null);

      const res = await request(app)
        .post('/transactions')
        .set('X-Service-Token', 'test-token')
        .send({
          createdBy: 1,
          reason: 'test',
          participants: [
            { kind: 'system', name: 'nonexistent', amount: -100 },
            { kind: 'user', userId: 1, amount: 100 },
          ],
        });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('ACCOUNT_NOT_FOUND');
      expect(res.body.message).toContain('nonexistent');
      expect(mockedPostTransaction).not.toHaveBeenCalled();
    });

    it('returns 404 when direct account not found', async () => {
      mockedAccounts.findAccountById.mockResolvedValue(null);

      const res = await request(app)
        .post('/transactions')
        .set('X-Service-Token', 'test-token')
        .send({
          createdBy: 1,
          reason: 'test',
          participants: [{ kind: 'account', accountId: 999, amount: 100 }],
        });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('ACCOUNT_NOT_FOUND');
      expect(mockedPostTransaction).not.toHaveBeenCalled();
    });
  });

  describe('entries passthrough', () => {
    it('passes entries directly without resolution', async () => {
      mockedPostTransaction.mockResolvedValue({
        transactionId: 125,
        createdAt: new Date('2025-01-01T00:00:00Z'),
        entries: [
          { accountId: 1, delta: -50, balanceAfter: 850 },
          { accountId: 3, delta: 50, balanceAfter: 50 },
        ],
        idempotent: false,
      });

      const res = await request(app)
        .post('/transactions')
        .set('X-Service-Token', 'test-token')
        .send({
          createdBy: 1,
          reason: 'direct_transfer',
          entries: [
            { accountId: 1, amount: -50 },
            { accountId: 3, amount: 50 },
          ],
        });

      expect(res.status).toBe(201);
      expect(res.body.transactionId).toBe(125);
      // No account lookups should happen with raw entries
      expect(mockedAccounts.findUserAccountByUserId).not.toHaveBeenCalled();
      expect(mockedAccounts.findSystemAccountByName).not.toHaveBeenCalled();
      expect(mockedAccounts.findAccountById).not.toHaveBeenCalled();
      expect(mockedPostTransaction).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          entries: [
            { accountId: 1, amount: -50 },
            { accountId: 3, amount: 50 },
          ],
        }),
      );
    });
  });

  describe('idempotency', () => {
    it('returns 200 for idempotent transaction', async () => {
      mockedPostTransaction.mockResolvedValue({
        transactionId: 123,
        createdAt: new Date('2025-01-01T00:00:00Z'),
        entries: [{ accountId: 1, delta: -100, balanceAfter: 900 }],
        idempotent: true,
      });

      const res = await request(app)
        .post('/transactions')
        .set('X-Service-Token', 'test-token')
        .send({
          createdBy: 1,
          reason: 'test',
          idempotencyKey: 'duplicate-key',
          entries: [
            { accountId: 1, amount: -100 },
            { accountId: 2, amount: 100 },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.idempotent).toBe(true);
    });

    it('returns 201 for new transaction', async () => {
      mockedPostTransaction.mockResolvedValue({
        transactionId: 123,
        createdAt: new Date('2025-01-01T00:00:00Z'),
        entries: [{ accountId: 1, delta: -100, balanceAfter: 900 }],
        idempotent: false,
      });

      const res = await request(app)
        .post('/transactions')
        .set('X-Service-Token', 'test-token')
        .send({
          createdBy: 1,
          reason: 'test',
          entries: [
            { accountId: 1, amount: -100 },
            { accountId: 2, amount: 100 },
          ],
        });

      expect(res.status).toBe(201);
      expect(res.body.idempotent).toBe(false);
    });
  });

  describe('validation', () => {
    it('returns 400 when both entries and participants are provided', async () => {
      const res = await request(app)
        .post('/transactions')
        .set('X-Service-Token', 'test-token')
        .send({
          createdBy: 1,
          reason: 'test',
          entries: [{ accountId: 1, amount: -100 }],
          participants: [{ kind: 'user', userId: 1, amount: 100 }],
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('BAD_REQUEST');
    });

    it('returns 400 when neither entries nor participants are provided', async () => {
      const res = await request(app)
        .post('/transactions')
        .set('X-Service-Token', 'test-token')
        .send({
          createdBy: 1,
          reason: 'test',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('BAD_REQUEST');
    });

    it('returns 400 when createdBy is missing', async () => {
      const res = await request(app)
        .post('/transactions')
        .set('X-Service-Token', 'test-token')
        .send({
          reason: 'test',
          entries: [{ accountId: 1, amount: 100 }],
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('BAD_REQUEST');
    });

    it('returns 400 when reason is missing', async () => {
      const res = await request(app)
        .post('/transactions')
        .set('X-Service-Token', 'test-token')
        .send({
          createdBy: 1,
          entries: [{ accountId: 1, amount: 100 }],
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('BAD_REQUEST');
    });

    it('returns 400 for entry missing accountId', async () => {
      const res = await request(app)
        .post('/transactions')
        .set('X-Service-Token', 'test-token')
        .send({
          createdBy: 1,
          reason: 'test',
          entries: [{ amount: 100 }],
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('BAD_REQUEST');
      expect(res.body.message).toContain('Account IDs must be integers');
      expect(mockedPostTransaction).not.toHaveBeenCalled();
    });

    it('returns 400 for entry with non-integer accountId', async () => {
      const res = await request(app)
        .post('/transactions')
        .set('X-Service-Token', 'test-token')
        .send({
          createdBy: 1,
          reason: 'test',
          entries: [{ accountId: 'abc', amount: 100 }],
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('BAD_REQUEST');
      expect(res.body.message).toContain('Account IDs must be integers');
      expect(mockedPostTransaction).not.toHaveBeenCalled();
    });

    it('returns 400 for non-object entry', async () => {
      const res = await request(app)
        .post('/transactions')
        .set('X-Service-Token', 'test-token')
        .send({
          createdBy: 1,
          reason: 'test',
          entries: ['invalid'],
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('BAD_REQUEST');
      expect(res.body.message).toContain('index 0');
      expect(mockedPostTransaction).not.toHaveBeenCalled();
    });

    it('returns 400 for participant missing kind', async () => {
      const res = await request(app)
        .post('/transactions')
        .set('X-Service-Token', 'test-token')
        .send({
          createdBy: 1,
          reason: 'test',
          participants: [{ userId: 1, amount: 100 }],
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('BAD_REQUEST');
      expect(res.body.message).toContain('index 0');
    });

    it('returns 400 for participant with unknown kind', async () => {
      const res = await request(app)
        .post('/transactions')
        .set('X-Service-Token', 'test-token')
        .send({
          createdBy: 1,
          reason: 'test',
          participants: [{ kind: 'unknown', amount: 100 }],
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('BAD_REQUEST');
      expect(res.body.message).toContain('index 0');
    });

    it('returns 400 for user participant missing userId', async () => {
      const res = await request(app)
        .post('/transactions')
        .set('X-Service-Token', 'test-token')
        .send({
          createdBy: 1,
          reason: 'test',
          participants: [{ kind: 'user', amount: 100 }],
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('BAD_REQUEST');
      expect(res.body.message).toContain('index 0');
    });

    it('returns 400 for user participant with non-number userId', async () => {
      const res = await request(app)
        .post('/transactions')
        .set('X-Service-Token', 'test-token')
        .send({
          createdBy: 1,
          reason: 'test',
          participants: [{ kind: 'user', userId: 'abc', amount: 100 }],
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('BAD_REQUEST');
      expect(res.body.message).toContain('index 0');
    });

    it('returns 400 for system participant missing name', async () => {
      const res = await request(app)
        .post('/transactions')
        .set('X-Service-Token', 'test-token')
        .send({
          createdBy: 1,
          reason: 'test',
          participants: [{ kind: 'system', amount: 100 }],
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('BAD_REQUEST');
      expect(res.body.message).toContain('index 0');
    });

    it('returns 400 for account participant missing accountId', async () => {
      const res = await request(app)
        .post('/transactions')
        .set('X-Service-Token', 'test-token')
        .send({
          createdBy: 1,
          reason: 'test',
          participants: [{ kind: 'account', amount: 100 }],
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('BAD_REQUEST');
      expect(res.body.message).toContain('index 0');
    });

    it('returns 400 for invalid participant at specific index', async () => {
      const res = await request(app)
        .post('/transactions')
        .set('X-Service-Token', 'test-token')
        .send({
          createdBy: 1,
          reason: 'test',
          participants: [
            { kind: 'user', userId: 1, amount: -100 },
            { kind: 'system', amount: 100 }, // missing name
          ],
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('BAD_REQUEST');
      expect(res.body.message).toContain('index 1');
    });
  });

  describe('transaction errors', () => {
    it('returns 400 for unbalanced transaction', async () => {
      mockedPostTransaction.mockRejectedValue(
        new transactionsCore.TransactionError(
          'UNBALANCED_TRANSACTION',
          'Transaction entries do not sum to zero',
        ),
      );

      const res = await request(app)
        .post('/transactions')
        .set('X-Service-Token', 'test-token')
        .send({
          createdBy: 1,
          reason: 'test',
          entries: [{ accountId: 1, amount: 100 }],
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('UNBALANCED_TRANSACTION');
    });

    it('returns 400 for invalid amount', async () => {
      mockedPostTransaction.mockRejectedValue(
        new transactionsCore.TransactionError(
          'INVALID_AMOUNT',
          'Zero-amount entries are not allowed',
        ),
      );

      const res = await request(app)
        .post('/transactions')
        .set('X-Service-Token', 'test-token')
        .send({
          createdBy: 1,
          reason: 'test',
          entries: [
            { accountId: 1, amount: 0 },
            { accountId: 2, amount: 0 },
          ],
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('INVALID_AMOUNT');
    });

    it('returns 422 for insufficient funds', async () => {
      mockedPostTransaction.mockRejectedValue(
        new transactionsCore.TransactionError(
          'INSUFFICIENT_FUNDS',
          'Account has insufficient funds',
        ),
      );

      const res = await request(app)
        .post('/transactions')
        .set('X-Service-Token', 'test-token')
        .send({
          createdBy: 1,
          reason: 'test',
          entries: [
            { accountId: 1, amount: -1000000 },
            { accountId: 2, amount: 1000000 },
          ],
        });

      expect(res.status).toBe(422);
      expect(res.body.error).toBe('INSUFFICIENT_FUNDS');
    });
  });

  describe('authentication', () => {
    it('returns 401 without service token', async () => {
      const res = await request(app)
        .post('/transactions')
        .send({
          createdBy: 1,
          reason: 'test',
          entries: [{ accountId: 1, amount: 100 }],
        });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('UNAUTHORIZED');
    });
  });
});
