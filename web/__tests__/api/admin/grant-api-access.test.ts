import { POST } from '@/api/admin/grant-api-access/route';
import { sql } from '@/actions/db';
import redis from '@/actions/redis';
import { NextRequest } from 'next/server';

jest.mock('@/actions/admin', () => {
  const actual =
    jest.requireActual<typeof import('@/actions/admin')>('@/actions/admin');
  return {
    ...actual,
    grantApiAccess: jest.fn(actual.grantApiAccess),
  };
});

jest.mock('@/api/admin/auth', () => ({
  validateDiscordBotAuth: jest.fn(),
}));

jest.mock('@/actions/redis');

import { validateDiscordBotAuth } from '@/api/admin/auth';
import { grantApiAccess } from '@/actions/admin';

const mockValidateAuth = validateDiscordBotAuth as jest.MockedFunction<
  typeof validateDiscordBotAuth
>;
const mockGrantApiAccess = grantApiAccess as jest.MockedFunction<
  typeof grantApiAccess
>;

const mockedRedis = redis as jest.MockedFunction<typeof redis>;

describe('POST /api/admin/grant-api-access', () => {
  let testUserId: number;

  beforeEach(async () => {
    mockValidateAuth.mockClear();
    mockGrantApiAccess.mockClear();
    mockedRedis.mockResolvedValue({
      get: jest.fn().mockResolvedValue(null),
    } as unknown as Awaited<ReturnType<typeof redis>>);

    const users = await sql<{ id: number }[]>`
      INSERT INTO users (username, password, email)
      VALUES ('test-user', 'hashed-password', 'test@example.com')
      RETURNING id
    `;
    testUserId = users[0].id;
  });

  afterEach(async () => {
    await sql`DELETE FROM users`;
    mockedRedis.mockReset();
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
      { discordId: '123456789012345678' },
      'Bearer invalid',
    );
    const response = await POST(request);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'unauthorized' });
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

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_body' });
  });

  it('should return 400 when discordId is missing', async () => {
    mockValidateAuth.mockReturnValue(true);

    const request = createRequest({}, 'Bearer valid');
    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'missing_fields' });
  });

  it('should return 404 when user is not found', async () => {
    mockValidateAuth.mockReturnValue(true);

    const request = createRequest(
      { discordId: '999999999999999999' },
      'Bearer valid',
    );
    const response = await POST(request);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'user_not_found' });
  });

  it('should return 200 when access is granted successfully', async () => {
    mockValidateAuth.mockReturnValue(true);

    await sql`
      UPDATE users
      SET discord_id = '123456789012345678', discord_username = 'testuser#1234'
      WHERE id = ${testUserId}
    `;

    const request = createRequest(
      { discordId: '123456789012345678' },
      'Bearer valid',
    );
    const response = await POST(request);

    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.user.canCreateApiKey).toBe(true);
  });

  it('should return 403 when limit is reached', async () => {
    mockValidateAuth.mockReturnValue(true);
    mockedRedis.mockResolvedValue({
      get: jest.fn().mockResolvedValue('0'),
    } as unknown as Awaited<ReturnType<typeof redis>>);

    await sql`
      UPDATE users
      SET discord_id = '123456789012345678', discord_username = 'testuser#1234'
      WHERE id = ${testUserId}
    `;

    const request = createRequest(
      { discordId: '123456789012345678' },
      'Bearer valid',
    );
    const response = await POST(request);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'limit_reached' });
  });

  it('should return 503 when service is unavailable', async () => {
    mockValidateAuth.mockReturnValue(true);
    mockedRedis.mockRejectedValue(new Error('Redis connection failed'));

    const originalEnv = process.env.BLERT_API_KEY_USER_LIMIT;
    delete process.env.BLERT_API_KEY_USER_LIMIT;

    await sql`
      UPDATE users
      SET discord_id = '123456789012345678', discord_username = 'testuser#1234'
      WHERE id = ${testUserId}
    `;

    const request = createRequest(
      { discordId: '123456789012345678' },
      'Bearer valid',
    );
    const response = await POST(request);

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'unavailable' });

    if (originalEnv !== undefined) {
      process.env.BLERT_API_KEY_USER_LIMIT = originalEnv;
    }
  });

  it('should return 500 internal_error when grantApiAccess throws unexpectedly', async () => {
    mockValidateAuth.mockReturnValue(true);
    mockGrantApiAccess.mockRejectedValueOnce(new Error('database failure'));

    const request = createRequest(
      { discordId: '123456789012345678' },
      'Bearer valid',
    );
    const response = await POST(request);

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'internal_error' });
  });
});
