import {
  getLinkedRsns,
  grantApiAccess,
  verifyDiscordLink,
} from '@/actions/admin';
import { sql } from '@/actions/db';
import redis from '@/actions/redis';

jest.mock('@/actions/redis');

const mockedRedis = redis as jest.MockedFunction<typeof redis>;

describe('admin actions', () => {
  let testUserId: number;
  let testUserId2: number;

  beforeEach(async () => {
    // Mock Redis to return no limit configured.
    mockedRedis.mockResolvedValue({
      get: jest.fn().mockResolvedValue(null),
    } as unknown as Awaited<ReturnType<typeof redis>>);

    const users = await sql<{ id: number }[]>`
      INSERT INTO users (username, password, email)
      VALUES
        ('test-user', 'hashed-password', 'test-user@example.com'),
        ('test-user-2', 'hashed-password-2', 'test-user-2@example.com')
      RETURNING id
    `;
    testUserId = users[0].id;
    testUserId2 = users[1].id;
  });

  afterEach(async () => {
    await sql`DELETE FROM account_linking_codes`;
    await sql`DELETE FROM users`;
    mockedRedis.mockReset();
  });

  afterAll(async () => {
    await sql.end();
  });

  describe('verifyDiscordLink', () => {
    it('should successfully link a Discord account with a valid code', async () => {
      const code = 'ABC12345';
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

      await sql`
        INSERT INTO account_linking_codes (code, user_id, type, expires_at)
        VALUES (${code}, ${testUserId}, 'discord', ${expiresAt})
      `;

      const result = await verifyDiscordLink(
        code,
        '123456789012345678',
        'testuser#1234',
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.user.id).toBe(testUserId);
        expect(result.user.username).toBe('test-user');
        expect(result.user.discordId).toBe('123456789012345678');
        expect(result.user.discordUsername).toBe('testuser#1234');
      }

      const users = await sql<
        { discord_id: string; discord_username: string }[]
      >`
        SELECT discord_id, discord_username
        FROM users
        WHERE id = ${testUserId}
      `;
      expect(users[0].discord_id).toBe('123456789012345678');
      expect(users[0].discord_username).toBe('testuser#1234');

      // Verify the code was deleted.
      const codes = await sql`
        SELECT * FROM account_linking_codes WHERE code = ${code}
      `;
      expect(codes).toHaveLength(0);
    });

    it('should return invalid_code error for non-existent code', async () => {
      const result = await verifyDiscordLink(
        'INVALID1',
        '123456789012345678',
        'testuser#1234',
      );

      expect(result).toEqual({ success: false, error: 'invalid_code' });
    });

    it('should return expired error and delete code when code is expired', async () => {
      const code = 'EXPIRED1';
      const expiresAt = new Date(Date.now() - 1000);

      await sql`
        INSERT INTO account_linking_codes (code, user_id, type, expires_at)
        VALUES (${code}, ${testUserId}, 'discord', ${expiresAt})
      `;

      const result = await verifyDiscordLink(
        code,
        '123456789012345678',
        'testuser#1234',
      );

      expect(result).toEqual({ success: false, error: 'expired' });

      // Verify the expired code was deleted.
      const codes = await sql`
        SELECT * FROM account_linking_codes WHERE code = ${code}
      `;
      expect(codes).toHaveLength(0);
    });

    it('should return conflict error when Discord account is already linked to a different user', async () => {
      await sql`
        UPDATE users
        SET discord_id = '123456789012345678', discord_username = 'existing#5678'
        WHERE id = ${testUserId2}
      `;

      // Try to link the same Discord account to user 1.
      const code = 'CNFLCT01';
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

      await sql`
        INSERT INTO account_linking_codes (code, user_id, type, expires_at)
        VALUES (${code}, ${testUserId}, 'discord', ${expiresAt})
      `;

      const result = await verifyDiscordLink(
        code,
        '123456789012345678',
        'testuser#1234',
      );

      expect(result).toEqual({ success: false, error: 'conflict' });
    });

    it('should allow relinking the same Discord account to the same user', async () => {
      await sql`
        UPDATE users
        SET discord_id = '123456789012345678', discord_username = 'old#1234'
        WHERE id = ${testUserId}
      `;

      // Try to link the same Discord account to the same user with a new
      // username.
      const code = 'RELINK01';
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

      await sql`
        INSERT INTO account_linking_codes (code, user_id, type, expires_at)
        VALUES (${code}, ${testUserId}, 'discord', ${expiresAt})
      `;

      const result = await verifyDiscordLink(
        code,
        '123456789012345678',
        'new#5678',
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.user.discordUsername).toBe('new#5678');
      }
    });
  });

  describe('grantApiAccess', () => {
    it('should successfully grant API access to a user with linked Discord account', async () => {
      await sql`
        UPDATE users
        SET discord_id = '123456789012345678', discord_username = 'testuser#1234'
        WHERE id = ${testUserId}
      `;

      const result = await grantApiAccess('123456789012345678');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.user.id).toBe(testUserId);
        expect(result.user.username).toBe('test-user');
        expect(result.user.canCreateApiKey).toBe(true);
      }

      const users = await sql<{ can_create_api_key: boolean }[]>`
        SELECT can_create_api_key
        FROM users
        WHERE id = ${testUserId}
      `;
      expect(users[0].can_create_api_key).toBe(true);
    });

    it('should return user_not_found error when Discord ID is not linked', async () => {
      const result = await grantApiAccess('999999999999999999');

      expect(result).toEqual({ success: false, error: 'user_not_found' });
    });

    it('should be idempotent when granting access twice', async () => {
      await sql`
        UPDATE users
        SET discord_id = '123456789012345678',
            discord_username = 'testuser#1234',
            can_create_api_key = true
        WHERE id = ${testUserId}
      `;

      const result = await grantApiAccess('123456789012345678');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.user.canCreateApiKey).toBe(true);
      }
    });

    it('should return limit_reached when at capacity', async () => {
      mockedRedis.mockResolvedValue({
        get: jest.fn().mockResolvedValue('1'),
      } as unknown as Awaited<ReturnType<typeof redis>>);

      // Create a user who already has API access to fill the limit.
      await sql`
        INSERT INTO users (username, password, email, can_create_api_key)
        VALUES ('existing-user', 'hashed-password', 'existing@example.com', true)
      `;

      await sql`
        UPDATE users
        SET discord_id = '123456789012345678', discord_username = 'testuser#1234'
        WHERE id = ${testUserId}
      `;

      const result = await grantApiAccess('123456789012345678');

      expect(result).toEqual({ success: false, error: 'limit_reached' });

      // The user should have been granted access.
      const users = await sql<{ can_create_api_key: boolean }[]>`
        SELECT can_create_api_key
        FROM users
        WHERE id = ${testUserId}
      `;
      expect(users[0].can_create_api_key).toBe(false);
    });

    it('should return unavailable when Redis is down and no env fallback', async () => {
      mockedRedis.mockRejectedValue(new Error('Redis connection failed'));

      const originalEnv = process.env.BLERT_API_KEY_USER_LIMIT;
      delete process.env.BLERT_API_KEY_USER_LIMIT;

      await sql`
        UPDATE users
        SET discord_id = '123456789012345678', discord_username = 'testuser#1234'
        WHERE id = ${testUserId}
      `;

      const result = await grantApiAccess('123456789012345678');

      expect(result).toEqual({ success: false, error: 'unavailable' });

      if (originalEnv !== undefined) {
        process.env.BLERT_API_KEY_USER_LIMIT = originalEnv;
      }
    });

    it('should use env var fallback when Redis is unavailable', async () => {
      mockedRedis.mockRejectedValue(new Error('Redis connection failed'));

      const originalEnv = process.env.BLERT_API_KEY_USER_LIMIT;
      process.env.BLERT_API_KEY_USER_LIMIT = '100';

      await sql`
        UPDATE users
        SET discord_id = '123456789012345678', discord_username = 'testuser#1234'
        WHERE id = ${testUserId}
      `;

      const result = await grantApiAccess('123456789012345678');

      expect(result.success).toBe(true);

      if (originalEnv !== undefined) {
        process.env.BLERT_API_KEY_USER_LIMIT = originalEnv;
      } else {
        delete process.env.BLERT_API_KEY_USER_LIMIT;
      }
    });

    it('should allow granting access when under limit', async () => {
      mockedRedis.mockResolvedValue({
        get: jest.fn().mockResolvedValue('10'),
      } as unknown as Awaited<ReturnType<typeof redis>>);

      await sql`
        UPDATE users
        SET discord_id = '123456789012345678', discord_username = 'testuser#1234'
        WHERE id = ${testUserId}
      `;

      const result = await grantApiAccess('123456789012345678');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.user.canCreateApiKey).toBe(true);
      }
    });

    it('should skip limit check for user who already has access', async () => {
      mockedRedis.mockResolvedValue({
        get: jest.fn().mockResolvedValue('0'), // Limit is 0.
      } as unknown as Awaited<ReturnType<typeof redis>>);

      await sql`
        UPDATE users
        SET discord_id = '123456789012345678',
            discord_username = 'testuser#1234',
            can_create_api_key = true
        WHERE id = ${testUserId}
      `;

      const result = await grantApiAccess('123456789012345678');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.user.canCreateApiKey).toBe(true);
      }
    });
  });

  describe('getLinkedRsns', () => {
    let playerId1: number;
    let playerId2: number;

    beforeEach(async () => {
      // Create test players.
      const players = await sql<{ id: number }[]>`
        INSERT INTO players (username)
        VALUES ('PlayerOne'), ('PlayerTwo')
        RETURNING id
      `;
      playerId1 = players[0].id;
      playerId2 = players[1].id;
    });

    afterEach(async () => {
      await sql`DELETE FROM api_keys`;
      await sql`DELETE FROM players`;
    });

    it('should return RSNs for a user with linked API keys', async () => {
      await sql`
        UPDATE users
        SET discord_id = '123456789012345678', discord_username = 'testuser#1234'
        WHERE id = ${testUserId}
      `;

      await sql`
        INSERT INTO api_keys (user_id, player_id, key, last_used)
        VALUES (${testUserId}, ${playerId1}, 'test-key-1', NOW())
      `;

      const result = await getLinkedRsns(['123456789012345678']);

      expect(result).toHaveLength(1);
      expect(result[0].discordId).toBe('123456789012345678');
      expect(result[0].rsns).toEqual(['PlayerOne']);
    });

    it('should return multiple RSNs for a user with multiple API keys', async () => {
      await sql`
        UPDATE users
        SET discord_id = '123456789012345678', discord_username = 'testuser#1234'
        WHERE id = ${testUserId}
      `;

      await sql`
        INSERT INTO api_keys (user_id, player_id, key, last_used)
        VALUES
          (${testUserId}, ${playerId1}, 'test-key-1', NOW()),
          (${testUserId}, ${playerId2}, 'test-key-2', NOW())
      `;

      const result = await getLinkedRsns(['123456789012345678']);

      expect(result).toHaveLength(1);
      expect(result[0].discordId).toBe('123456789012345678');
      expect(result[0].rsns).toEqual(['PlayerOne', 'PlayerTwo']);
    });

    it('should return empty array for Discord ID with no linked RSNs', async () => {
      await sql`
        UPDATE users
        SET discord_id = '123456789012345678', discord_username = 'testuser#1234'
        WHERE id = ${testUserId}
      `;

      const result = await getLinkedRsns(['123456789012345678']);

      expect(result).toHaveLength(1);
      expect(result[0].discordId).toBe('123456789012345678');
      expect(result[0].rsns).toEqual([]);
    });

    it('should return empty array for unknown Discord ID', async () => {
      const result = await getLinkedRsns(['999999999999999999']);

      expect(result).toHaveLength(1);
      expect(result[0].discordId).toBe('999999999999999999');
      expect(result[0].rsns).toEqual([]);
    });

    it('should return results for multiple Discord IDs', async () => {
      await sql`
        UPDATE users
        SET discord_id = '123456789012345678', discord_username = 'testuser#1234'
        WHERE id = ${testUserId}
      `;
      await sql`
        UPDATE users
        SET discord_id = '987654321098765432', discord_username = 'testuser2#5678'
        WHERE id = ${testUserId2}
      `;

      await sql`
        INSERT INTO api_keys (user_id, player_id, key, last_used)
        VALUES
          (${testUserId}, ${playerId1}, 'test-key-1', NOW()),
          (${testUserId2}, ${playerId2}, 'test-key-2', NOW())
      `;

      const result = await getLinkedRsns([
        '123456789012345678',
        '987654321098765432',
      ]);

      expect(result).toHaveLength(2);

      const user1Result = result.find(
        (r) => r.discordId === '123456789012345678',
      );
      const user2Result = result.find(
        (r) => r.discordId === '987654321098765432',
      );

      expect(user1Result?.rsns).toEqual(['PlayerOne']);
      expect(user2Result?.rsns).toEqual(['PlayerTwo']);
    });

    it('should handle mix of found and not found Discord IDs', async () => {
      await sql`
        UPDATE users
        SET discord_id = '123456789012345678', discord_username = 'testuser#1234'
        WHERE id = ${testUserId}
      `;

      await sql`
        INSERT INTO api_keys (user_id, player_id, key, last_used)
        VALUES (${testUserId}, ${playerId1}, 'test-key-1', NOW())
      `;

      const result = await getLinkedRsns([
        '123456789012345678',
        '999999999999999999',
      ]);

      expect(result).toHaveLength(2);

      const foundResult = result.find(
        (r) => r.discordId === '123456789012345678',
      );
      const notFoundResult = result.find(
        (r) => r.discordId === '999999999999999999',
      );

      expect(foundResult?.rsns).toEqual(['PlayerOne']);
      expect(notFoundResult?.rsns).toEqual([]);
    });
  });
});
