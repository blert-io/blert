jest.mock('@/actions/challenge', () => ({
  getPlayerStatsHistory: jest.fn(),
}));
jest.mock('@/utils/metrics', () => ({
  observeHttpRequest: jest.fn(),
}));

import { getPlayerStatsHistory } from '@/actions/challenge';
import { apiRequest } from '@/api/__tests__/request';

import { GET } from '../route';

const mockedGetPlayerStatsHistory =
  getPlayerStatsHistory as jest.MockedFunction<typeof getPlayerStatsHistory>;

const USERNAME = 'Caps lock13';
const PATH = `/api/v1/players/${USERNAME}/stats`;

function get(params: Record<string, string> = {}): Promise<Response> {
  return GET(apiRequest(PATH, params), {
    params: Promise.resolve({ username: USERNAME }),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedGetPlayerStatsHistory.mockResolvedValue([]);
});

describe('GET /api/v1/players/[username]/stats', () => {
  it('queries without any filters by default', async () => {
    mockedGetPlayerStatsHistory.mockResolvedValue([
      { date: new Date('2026-09-15'), tobCompletions: 6, deathsTotal: 3 },
    ]);
    const response = await get();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      {
        date: '2026-09-15T00:00:00.000Z',
        tobCompletions: 6,
        deathsTotal: 3,
      },
    ]);
    expect(mockedGetPlayerStatsHistory).toHaveBeenCalledWith(
      USERNAME,
      undefined,
      {},
    );
  });

  it('uses the start of the day for before and after filters', async () => {
    const response = await get({
      after: '2026-09-14T13:16:00.173Z',
      before: '1789478160173',
      limit: '2',
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
    expect(mockedGetPlayerStatsHistory).toHaveBeenCalledWith(USERNAME, 2, {
      after: new Date('2026-09-14T00:00:00.000Z'),
      before: new Date('2026-09-15T00:00:00.000Z'),
    });
  });

  it('accepts a list of fields to query', async () => {
    const response = await get({ which: 'tobWipes,tobResets,deathsTotal' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
    expect(mockedGetPlayerStatsHistory).toHaveBeenCalledWith(
      USERNAME,
      undefined,
      { fields: ['tobWipes', 'tobResets', 'deathsTotal'] },
    );
  });

  it.each<[Record<string, string>, string]>([
    [{ limit: '0' }, 'limit'],
    [{ limit: 'abc' }, 'limit'],
    [{ after: 'abc' }, 'after'],
    [{ before: '8640000000000001' }, 'before'],
  ])('rejects %j', async (params, name) => {
    const response = await get(params);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain(name);
    expect(mockedGetPlayerStatsHistory).not.toHaveBeenCalled();
  });
});
