import { postTransaction, TransactionError } from '@/core/transactions';

import {
  createUserAccount,
  getBalance,
  getTransaction,
  seedSystemAccounts,
  truncateTables,
} from './setup';

describe('postTransaction', () => {
  let treasuryId: number;
  let purchasesId: number;

  beforeEach(async () => {
    await truncateTables();
    const accounts = await seedSystemAccounts();
    treasuryId = accounts.treasuryId;
    purchasesId = accounts.purchasesId;
  });

  describe('basic transactions', () => {
    it('transfers coins from treasury to user', async () => {
      const userAccountId = await createUserAccount(1);

      const result = await postTransaction('test-service', {
        createdBy: 0,
        reason: 'test_reward',
        entries: [
          { accountId: treasuryId, amount: -100 },
          { accountId: userAccountId, amount: 100 },
        ],
      });

      expect(result.transactionId).toBeGreaterThan(0);
      expect(result.idempotent).toBe(false);
      expect(result.entries).toHaveLength(2);

      // Verify balances.
      expect(await getBalance(treasuryId)).toBe(-100);
      expect(await getBalance(userAccountId)).toBe(100);
    });

    it('transfers coins from user to sink', async () => {
      const userAccountId = await createUserAccount(1, 500);

      const result = await postTransaction('test-service', {
        createdBy: 1,
        reason: 'test_purchase',
        entries: [
          { accountId: userAccountId, amount: -200 },
          { accountId: purchasesId, amount: 200 },
        ],
      });

      expect(result.transactionId).toBeGreaterThan(0);
      expect(await getBalance(userAccountId)).toBe(300);
      expect(await getBalance(purchasesId)).toBe(200);
    });

    it('handles multi-party transactions', async () => {
      const user1AccountId = await createUserAccount(1);
      const user2AccountId = await createUserAccount(2);
      const user3AccountId = await createUserAccount(3);

      const result = await postTransaction('test-service', {
        createdBy: 0,
        reason: 'raid_reward',
        entries: [
          { accountId: treasuryId, amount: -300 },
          { accountId: user1AccountId, amount: 100 },
          { accountId: user2AccountId, amount: 100 },
          { accountId: user3AccountId, amount: 100 },
        ],
      });

      expect(result.entries).toHaveLength(4);
      expect(await getBalance(user1AccountId)).toBe(100);
      expect(await getBalance(user2AccountId)).toBe(100);
      expect(await getBalance(user3AccountId)).toBe(100);
      expect(await getBalance(treasuryId)).toBe(-300);
    });
  });

  describe('idempotency', () => {
    it('returns same result for duplicate idempotency key', async () => {
      const userAccountId = await createUserAccount(1);

      const result1 = await postTransaction('test-service', {
        createdBy: 0,
        reason: 'test_reward',
        idempotencyKey: 'unique-key-123',
        entries: [
          { accountId: treasuryId, amount: -100 },
          { accountId: userAccountId, amount: 100 },
        ],
      });

      expect(result1.idempotent).toBe(false);
      expect(await getBalance(userAccountId)).toBe(100);

      // Second call with same key should be idempotent.
      const result2 = await postTransaction('test-service', {
        createdBy: 0,
        reason: 'test_reward',
        idempotencyKey: 'unique-key-123',
        entries: [
          { accountId: treasuryId, amount: -100 },
          { accountId: userAccountId, amount: 100 },
        ],
      });

      expect(result2.idempotent).toBe(true);
      expect(result2.transactionId).toBe(result1.transactionId);
      expect(await getBalance(userAccountId)).toBe(100);
    });

    it('returns original balanceAfter on idempotent retries after intervening updates', async () => {
      const userAccountId = await createUserAccount(1);

      const result1 = await postTransaction('test-service', {
        createdBy: 0,
        reason: 'test_reward',
        idempotencyKey: 'unique-key-456',
        entries: [
          { accountId: treasuryId, amount: -100 },
          { accountId: userAccountId, amount: 100 },
        ],
      });

      const balances1 = new Map(
        result1.entries.map((entry) => [entry.accountId, entry.balanceAfter]),
      );

      await postTransaction('test-service', {
        createdBy: 1,
        reason: 'test_purchase',
        entries: [
          { accountId: userAccountId, amount: -25 },
          { accountId: purchasesId, amount: 25 },
        ],
      });

      expect(await getBalance(userAccountId)).toBe(75);

      const result2 = await postTransaction('test-service', {
        createdBy: 0,
        reason: 'test_reward',
        idempotencyKey: 'unique-key-456',
        entries: [
          { accountId: treasuryId, amount: -100 },
          { accountId: userAccountId, amount: 100 },
        ],
      });

      expect(result2.idempotent).toBe(true);
      expect(result2.transactionId).toBe(result1.transactionId);

      expect(result2.entries.length).toBe(result1.entries.length);
      for (const entry of result2.entries) {
        expect(balances1.get(entry.accountId)).toBe(entry.balanceAfter);
      }

      expect(await getBalance(userAccountId)).toBe(75);
    });

    it('allows different transactions without idempotency key', async () => {
      const userAccountId = await createUserAccount(1);

      await postTransaction('test-service', {
        createdBy: 0,
        reason: 'reward_1',
        entries: [
          { accountId: treasuryId, amount: -50 },
          { accountId: userAccountId, amount: 50 },
        ],
      });

      await postTransaction('test-service', {
        createdBy: 0,
        reason: 'reward_2',
        entries: [
          { accountId: treasuryId, amount: -50 },
          { accountId: userAccountId, amount: 50 },
        ],
      });

      expect(await getBalance(treasuryId)).toBe(-100);
      expect(await getBalance(userAccountId)).toBe(100);
    });
  });

  describe('validation errors', () => {
    it('rejects unbalanced transactions', async () => {
      const userAccountId = await createUserAccount(1);

      await expect(
        postTransaction('test-service', {
          createdBy: 0,
          reason: 'invalid',
          entries: [{ accountId: userAccountId, amount: 100 }],
        }),
      ).rejects.toThrow(TransactionError);

      await expect(
        postTransaction('test-service', {
          createdBy: 0,
          reason: 'invalid',
          entries: [{ accountId: userAccountId, amount: 100 }],
        }),
      ).rejects.toMatchObject({ code: 'UNBALANCED_TRANSACTION' });
    });

    it('rejects zero-amount entries', async () => {
      const userAccountId = await createUserAccount(1);

      await expect(
        postTransaction('test-service', {
          createdBy: 0,
          reason: 'invalid',
          entries: [
            { accountId: treasuryId, amount: 0 },
            { accountId: userAccountId, amount: 0 },
          ],
        }),
      ).rejects.toMatchObject({ code: 'INVALID_AMOUNT' });
    });

    it('rejects insufficient funds for user account', async () => {
      const userAccountId = await createUserAccount(1, 50);

      await expect(
        postTransaction('test-service', {
          createdBy: 1,
          reason: 'purchase',
          entries: [
            { accountId: userAccountId, amount: -100 },
            { accountId: purchasesId, amount: 100 },
          ],
        }),
      ).rejects.toMatchObject({ code: 'INSUFFICIENT_FUNDS' });

      // Balance should be unchanged.
      expect(await getBalance(userAccountId)).toBe(50);
    });

    it('allows treasury to go negative', async () => {
      const userAccountId = await createUserAccount(1);

      // Treasury starts at 0, should be able to go negative.
      const result = await postTransaction('test-service', {
        createdBy: 0,
        reason: 'reward',
        entries: [
          { accountId: treasuryId, amount: -1000000 },
          { accountId: userAccountId, amount: 1000000 },
        ],
      });

      expect(result.transactionId).toBeGreaterThan(0);
      expect(await getBalance(treasuryId)).toBe(-1000000);
    });

    it('prevents sink from going negative', async () => {
      await expect(
        postTransaction('test-service', {
          createdBy: 0,
          reason: 'invalid',
          entries: [
            { accountId: purchasesId, amount: -100 },
            { accountId: treasuryId, amount: 100 },
          ],
        }),
      ).rejects.toMatchObject({ code: 'INSUFFICIENT_FUNDS' });
    });
  });

  describe('metadata and source tracking', () => {
    it('stores metadata and source with transaction', async () => {
      const userAccountId = await createUserAccount(1);

      const result = await postTransaction('test-service', {
        createdBy: 42,
        reason: 'raid_reward',
        source: { table: 'challenges', id: 12345 },
        metadata: {
          challengeType: 'tob',
          scale: 3,
          completionTime: 1800,
        },
        entries: [
          { accountId: treasuryId, amount: -100 },
          { accountId: userAccountId, amount: 100 },
        ],
      });

      expect(result.transactionId).toBeGreaterThan(0);

      // Verify the transaction was stored correctly.
      const stored = await getTransaction(result.transactionId);
      expect(stored).not.toBeNull();
      expect(stored!.createdBy).toBe(42);
      expect(stored!.createdBySvc).toBe('test-service');
      expect(stored!.reason).toBe('raid_reward');
      expect(stored!.sourceTable).toBe('challenges');
      expect(stored!.sourceId).toBe(12345);
      expect(stored!.metadata).toEqual({
        challengeType: 'tob',
        scale: 3,
        completionTime: 1800,
      });
    });

    it('stores transaction without optional fields', async () => {
      const userAccountId = await createUserAccount(1);

      const result = await postTransaction('another-service', {
        createdBy: 1,
        reason: 'simple_transfer',
        entries: [
          { accountId: treasuryId, amount: -50 },
          { accountId: userAccountId, amount: 50 },
        ],
      });

      const stored = await getTransaction(result.transactionId);
      expect(stored).not.toBeNull();
      expect(stored!.createdBy).toBe(1);
      expect(stored!.createdBySvc).toBe('another-service');
      expect(stored!.reason).toBe('simple_transfer');
      expect(stored!.sourceTable).toBeNull();
      expect(stored!.sourceId).toBeNull();
      expect(stored!.metadata).toEqual({});
    });
  });
});
