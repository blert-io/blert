import { normalizeRsn } from '@blert/common';

import { connectedPlayersCache } from '@/actions/connected-players';
import { sql } from '@/actions/db';
import redis from '@/actions/redis';

jest.mock('@/actions/redis');

const mockedRedis = redis as jest.MockedFunction<typeof redis>;

const PLAYER_NAMES = ['tobdataegirl', 'Tob Data Boy', 'versik mele'];

describe('connectedPlayersCache', () => {
  let userId: number;
  let playerIds: Map<string, number>;

  beforeEach(async () => {
    mockedRedis.mockResolvedValue({
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue('OK'),
    } as unknown as Awaited<ReturnType<typeof redis>>);

    [{ id: userId }] = await sql<{ id: number }[]>`
      INSERT INTO users (username, email)
      VALUES ('cp-test-user', 'cp-test-user@example.com')
      RETURNING id
    `;

    const players = await sql<{ id: number; username: string }[]>`
      INSERT INTO players ${sql(
        PLAYER_NAMES.map((username) => ({
          username,
          normalized_username: normalizeRsn(username),
        })),
      )}
      RETURNING id, username
    `;
    playerIds = new Map(players.map((p) => [p.username, p.id]));
  });

  afterEach(async () => {
    await sql`DELETE FROM users WHERE id = ${userId}`;
    await sql`DELETE FROM players WHERE id = ANY(${[...playerIds.values()]})`;
    mockedRedis.mockReset();
  });

  afterAll(async () => {
    await sql.end();
  });

  async function link(username: string): Promise<void> {
    await sql`
      INSERT INTO api_keys (user_id, player_id, key)
      VALUES (${userId}, ${playerIds.get(username)!}, ${`cp-key-${username}`})
    `;
  }

  it('returns players in the order they were linked', async () => {
    await link('tobdataegirl');
    await link('versik mele');
    await link('Tob Data Boy');

    expect(await connectedPlayersCache.get(userId)).toEqual([
      { id: playerIds.get('tobdataegirl'), username: 'tobdataegirl' },
      { id: playerIds.get('versik mele'), username: 'versik mele' },
      { id: playerIds.get('Tob Data Boy'), username: 'Tob Data Boy' },
    ]);
  });

  it('returns an empty list for a user with no linked players', async () => {
    expect(await connectedPlayersCache.get(userId)).toEqual([]);
  });
});
