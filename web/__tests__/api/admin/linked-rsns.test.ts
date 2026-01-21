import { POST } from '@/api/admin/linked-rsns/route';
import { sql } from '@/actions/db';
import { NextRequest } from 'next/server';

jest.mock('@/api/admin/auth', () => ({
  validateDiscordBotAuth: jest.fn(),
}));

import { validateDiscordBotAuth } from '@/api/admin/auth';
import { LinkedRsnsResult } from '@/actions/admin';

const mockValidateAuth = validateDiscordBotAuth as jest.MockedFunction<
  typeof validateDiscordBotAuth
>;

describe('POST /api/admin/linked-rsns', () => {
  let testUserId: number;
  let testUserId2: number;
  let playerId1: number;
  let playerId2: number;

  beforeEach(async () => {
    mockValidateAuth.mockClear();

    const users = await sql<{ id: number }[]>`
      INSERT INTO users (username, password, email)
      VALUES
        ('test-user', 'hashed-password', 'test@example.com'),
        ('test-user-2', 'hashed-password-2', 'test2@example.com')
      RETURNING id
    `;
    testUserId = users[0].id;
    testUserId2 = users[1].id;

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

    return new NextRequest('http://localhost:3000/api/admin/linked-rsns', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  };

  it('should return 401 when authentication fails', async () => {
    mockValidateAuth.mockReturnValue(false);

    const request = createRequest(
      { discordIds: ['123456789012345678'] },
      'Bearer invalid',
    );
    const response = await POST(request);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'unauthorized' });
  });

  it('should return 400 when request body is invalid JSON', async () => {
    mockValidateAuth.mockReturnValue(true);

    const request = new NextRequest(
      'http://localhost:3000/api/admin/linked-rsns',
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

  it('should return 400 when discordIds is missing', async () => {
    mockValidateAuth.mockReturnValue(true);

    const request = createRequest({}, 'Bearer valid');
    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'missing_fields' });
  });

  it('should return 400 when discordIds is not an array', async () => {
    mockValidateAuth.mockReturnValue(true);

    const request = createRequest(
      { discordIds: '123456789012345678' },
      'Bearer valid',
    );
    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'missing_fields' });
  });

  it('should return 400 when discordIds is empty', async () => {
    mockValidateAuth.mockReturnValue(true);

    const request = createRequest({ discordIds: [] }, 'Bearer valid');
    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'missing_fields' });
  });

  it('should return 200 with RSNs for linked Discord accounts', async () => {
    mockValidateAuth.mockReturnValue(true);

    await sql`
      UPDATE users
      SET discord_id = '123456789012345678', discord_username = 'testuser#1234'
      WHERE id = ${testUserId}
    `;

    await sql`
      INSERT INTO api_keys (user_id, player_id, key, last_used)
      VALUES (${testUserId}, ${playerId1}, 'test-key-1', NOW())
    `;

    const request = createRequest(
      { discordIds: ['123456789012345678'] },
      'Bearer valid',
    );
    const response = await POST(request);

    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.results).toHaveLength(1);
    expect(data.results[0].discordId).toBe('123456789012345678');
    expect(data.results[0].rsns).toEqual(['PlayerOne']);
  });

  it('should return empty RSNs for Discord accounts without API keys', async () => {
    mockValidateAuth.mockReturnValue(true);

    await sql`
      UPDATE users
      SET discord_id = '123456789012345678', discord_username = 'testuser#1234'
      WHERE id = ${testUserId}
    `;

    const request = createRequest(
      { discordIds: ['123456789012345678'] },
      'Bearer valid',
    );
    const response = await POST(request);

    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.results).toHaveLength(1);
    expect(data.results[0].discordId).toBe('123456789012345678');
    expect(data.results[0].rsns).toEqual([]);
  });

  it('should return empty RSNs for unknown Discord IDs', async () => {
    mockValidateAuth.mockReturnValue(true);

    const request = createRequest(
      { discordIds: ['999999999999999999'] },
      'Bearer valid',
    );
    const response = await POST(request);

    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.results).toHaveLength(1);
    expect(data.results[0].discordId).toBe('999999999999999999');
    expect(data.results[0].rsns).toEqual([]);
  });

  it('should handle multiple Discord IDs', async () => {
    mockValidateAuth.mockReturnValue(true);

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

    const request = createRequest(
      { discordIds: ['123456789012345678', '987654321098765432'] },
      'Bearer valid',
    );
    const response = await POST(request);

    expect(response.status).toBe(200);

    const data = (await response.json()) as { results: LinkedRsnsResult[] };
    expect(data.results).toHaveLength(2);

    const user1Result = data.results.find(
      (r) => r.discordId === '123456789012345678',
    );
    const user2Result = data.results.find(
      (r) => r.discordId === '987654321098765432',
    );

    expect(user1Result?.rsns).toEqual(['PlayerOne']);
    expect(user2Result?.rsns).toEqual(['PlayerTwo']);
  });

  it('should return multiple RSNs for user with multiple API keys', async () => {
    mockValidateAuth.mockReturnValue(true);

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

    const request = createRequest(
      { discordIds: ['123456789012345678'] },
      'Bearer valid',
    );
    const response = await POST(request);

    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.results).toHaveLength(1);
    expect(data.results[0].rsns).toEqual(['PlayerOne', 'PlayerTwo']);
  });
});
