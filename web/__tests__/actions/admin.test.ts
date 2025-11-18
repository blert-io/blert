import { grantApiAccess, verifyDiscordLink } from '@/actions/admin';
import { sql } from '@/actions/db';

describe('admin actions', () => {
  let testUserId: number;
  let testUserId2: number;

  beforeEach(async () => {
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
  });
});
