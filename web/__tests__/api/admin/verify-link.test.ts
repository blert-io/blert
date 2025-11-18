import { POST } from '@/api/admin/verify-link/route';
import { sql } from '@/actions/db';
import { NextRequest } from 'next/server';

jest.mock('@/api/admin/auth', () => ({
  validateDiscordBotAuth: jest.fn(),
}));

import { validateDiscordBotAuth } from '@/api/admin/auth';

const mockValidateAuth = validateDiscordBotAuth as jest.MockedFunction<
  typeof validateDiscordBotAuth
>;

describe('POST /api/admin/verify-link', () => {
  let testUserId: number;

  beforeEach(async () => {
    mockValidateAuth.mockClear();

    const users = await sql<{ id: number }[]>`
      INSERT INTO users (username, password, email)
      VALUES ('test-user', 'hashed-password', 'test@example.com')
      RETURNING id
    `;
    testUserId = users[0].id;
  });

  afterEach(async () => {
    await sql`DELETE FROM account_linking_codes`;
    await sql`DELETE FROM users`;
  });

  afterAll(async () => {
    await sql.end();
  });

  const createRequest = (body: unknown, authHeader?: string | null) => {
    const headers = new Headers();
    if (authHeader !== undefined) {
      if (authHeader !== null) {
        headers.set('authorization', authHeader);
      }
    }

    return new NextRequest('http://localhost:3000/api/admin/verify-link', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  };

  it('should return 401 when authentication fails', async () => {
    mockValidateAuth.mockReturnValue(false);

    const request = createRequest(
      {
        code: 'ABC12345',
        discordId: '123456789012345678',
        discordUsername: 'testuser#1234',
      },
      'Bearer invalid',
    );

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data).toEqual({ error: 'unauthorized' });
    expect(mockValidateAuth).toHaveBeenCalledWith('Bearer invalid');
  });

  it('should return 400 when request body is invalid JSON', async () => {
    mockValidateAuth.mockReturnValue(true);

    const request = new NextRequest(
      'http://localhost:3000/api/admin/verify-link',
      {
        method: 'POST',
        headers: { authorization: 'Bearer valid' },
        body: 'invalid json{',
      },
    );

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: 'invalid_body' });
  });

  it('should return 400 when code is missing', async () => {
    mockValidateAuth.mockReturnValue(true);

    const request = createRequest(
      {
        discordId: '123456789012345678',
        discordUsername: 'testuser#1234',
      },
      'Bearer valid',
    );

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: 'missing_fields' });
  });

  it('should return 400 when discordId is missing', async () => {
    mockValidateAuth.mockReturnValue(true);

    const request = createRequest(
      {
        code: 'ABC12345',
        discordUsername: 'testuser#1234',
      },
      'Bearer valid',
    );

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: 'missing_fields' });
  });

  it('should return 400 when discordUsername is missing', async () => {
    mockValidateAuth.mockReturnValue(true);

    const request = createRequest(
      {
        code: 'ABC12345',
        discordId: '123456789012345678',
      },
      'Bearer valid',
    );

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: 'missing_fields' });
  });

  it('should return 404 when code is invalid', async () => {
    mockValidateAuth.mockReturnValue(true);

    const request = createRequest(
      {
        code: 'INVALID1',
        discordId: '123456789012345678',
        discordUsername: 'testuser#1234',
      },
      'Bearer valid',
    );

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data).toEqual({ error: 'invalid_code' });
  });

  it('should return 410 when code is expired', async () => {
    mockValidateAuth.mockReturnValue(true);

    const code = 'EXPIRED1';
    const expiresAt = new Date(Date.now() - 1000);

    await sql`
      INSERT INTO account_linking_codes (code, user_id, type, expires_at)
      VALUES (${code}, ${testUserId}, 'discord', ${expiresAt})
    `;

    const request = createRequest(
      {
        code,
        discordId: '123456789012345678',
        discordUsername: 'testuser#1234',
      },
      'Bearer valid',
    );

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(410);
    expect(data).toEqual({ error: 'expired' });
  });

  it('should return 409 when Discord account is already linked to another user', async () => {
    mockValidateAuth.mockReturnValue(true);

    // Create another user with the Discord account
    await sql`
      INSERT INTO users (username, password, email, discord_id, discord_username)
      VALUES ('other-user', 'password', 'other@example.com', '123456789012345678', 'existing#5678')
    `;

    const code = 'CNFLCT01';
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await sql`
      INSERT INTO account_linking_codes (code, user_id, type, expires_at)
      VALUES (${code}, ${testUserId}, 'discord', ${expiresAt})
    `;

    const request = createRequest(
      {
        code,
        discordId: '123456789012345678',
        discordUsername: 'testuser#1234',
      },
      'Bearer valid',
    );

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(409);
    expect(data).toEqual({ error: 'conflict' });
  });

  it('should return 200 and link Discord account successfully', async () => {
    mockValidateAuth.mockReturnValue(true);

    const code = 'VALID001';
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await sql`
      INSERT INTO account_linking_codes (code, user_id, type, expires_at)
      VALUES (${code}, ${testUserId}, 'discord', ${expiresAt})
    `;

    const request = createRequest(
      {
        code,
        discordId: '123456789012345678',
        discordUsername: 'testuser#1234',
      },
      'Bearer valid',
    );

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      success: true,
      user: {
        id: testUserId,
        username: 'test-user',
        discordId: '123456789012345678',
        discordUsername: 'testuser#1234',
      },
    });

    // User should be updated and the code should be deleted.
    const users = await sql<{ discord_id: string; discord_username: string }[]>`
      SELECT discord_id, discord_username
      FROM users
      WHERE id = ${testUserId}
    `;
    expect(users[0].discord_id).toBe('123456789012345678');
    expect(users[0].discord_username).toBe('testuser#1234');

    const codes = await sql`
      SELECT * FROM account_linking_codes WHERE code = ${code}
    `;
    expect(codes).toHaveLength(0);
  });
});
