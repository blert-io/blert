import { POST } from '@/api/admin/grant-api-access/route';
import { sql } from '@/actions/db';
import { NextRequest } from 'next/server';

jest.mock('@/api/admin/auth', () => ({
  validateDiscordBotAuth: jest.fn(),
}));

import { validateDiscordBotAuth } from '@/api/admin/auth';

const mockValidateAuth = validateDiscordBotAuth as jest.MockedFunction<
  typeof validateDiscordBotAuth
>;

describe('POST /api/admin/grant-api-access', () => {
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

    return new NextRequest('http://localhost:3000/api/admin/grant-api-access', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  };

  it('should return 401 when authentication fails', async () => {
    mockValidateAuth.mockReturnValue(false);

    const request = createRequest(
      {
        discordId: '123456789012345678',
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
      'http://localhost:3000/api/admin/grant-api-access',
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

  it('should return 400 when discordId is missing', async () => {
    mockValidateAuth.mockReturnValue(true);

    const request = createRequest({}, 'Bearer valid');

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: 'missing_fields' });
  });

  it('should return 404 when user is not found', async () => {
    mockValidateAuth.mockReturnValue(true);

    const request = createRequest(
      {
        discordId: '999999999999999999',
      },
      'Bearer valid',
    );

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data).toEqual({ error: 'user_not_found' });
  });

  it('should return 200 and grant API access successfully', async () => {
    mockValidateAuth.mockReturnValue(true);

    await sql`
      UPDATE users
      SET discord_id = '123456789012345678', discord_username = 'testuser#1234'
      WHERE id = ${testUserId}
    `;

    const request = createRequest(
      {
        discordId: '123456789012345678',
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
        canCreateApiKey: true,
      },
    });

    const users = await sql<{ can_create_api_key: boolean }[]>`
      SELECT can_create_api_key
      FROM users
      WHERE id = ${testUserId}
    `;
    expect(users[0].can_create_api_key).toBe(true);
  });

  it('should be idempotent when granting access twice', async () => {
    mockValidateAuth.mockReturnValue(true);

    await sql`
      UPDATE users
      SET discord_id = '123456789012345678',
          discord_username = 'testuser#1234',
          can_create_api_key = true
      WHERE id = ${testUserId}
    `;

    const request = createRequest(
      {
        discordId: '123456789012345678',
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
        canCreateApiKey: true,
      },
    });
  });
});
