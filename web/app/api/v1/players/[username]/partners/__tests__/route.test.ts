import { ChallengeMode, ChallengeType } from '@blert/common';

jest.mock('@/actions/challenge', () => ({
  topPartnersForPlayer: jest.fn(),
}));
jest.mock('@/utils/metrics', () => ({
  observeHttpRequest: jest.fn(),
}));

import { topPartnersForPlayer } from '@/actions/challenge';
import { apiRequest } from '@/api/__tests__/request';

import { GET } from '../route';

const mockedTopPartnersForPlayer = topPartnersForPlayer as jest.MockedFunction<
  typeof topPartnersForPlayer
>;

const USERNAME = 'Yieldofin';
const PATH = `/api/v1/players/${USERNAME}/partners`;

beforeEach(() => {
  jest.clearAllMocks();
  mockedTopPartnersForPlayer.mockResolvedValue([]);
});

describe('GET /api/v1/players/[username]/partners', () => {
  it('defaults to 10 partners without any filters', async () => {
    const response = await GET(apiRequest(PATH), {
      params: Promise.resolve({ username: USERNAME }),
    });
    expect(response.status).toBe(200);
    expect(mockedTopPartnersForPlayer).toHaveBeenCalledWith(USERNAME, {
      limit: 10,
      scale: undefined,
      mode: undefined,
      type: undefined,
      from: undefined,
      to: undefined,
    });
  });

  it('parses provided filters', async () => {
    const response = await GET(
      apiRequest(PATH, {
        limit: '3',
        scale: '1,3',
        mode: `${ChallengeMode.TOB_HARD}`,
        type: `${ChallengeType.TOB}`,
        from: '2026-01-01',
        to: '2026-02-01',
      }),
      { params: Promise.resolve({ username: USERNAME }) },
    );
    expect(response.status).toBe(200);
    expect(mockedTopPartnersForPlayer).toHaveBeenCalledWith(USERNAME, {
      limit: 3,
      scale: [1, 3],
      mode: ChallengeMode.TOB_HARD,
      type: ChallengeType.TOB,
      from: new Date('2026-01-01'),
      to: new Date('2026-02-01'),
    });
  });

  it.each<[Record<string, string>, string]>([
    [{ limit: '0' }, 'limit'],
    [{ limit: 'abc' }, 'limit'],
    [{ scale: '1,abc' }, 'scale'],
    [{ scale: '9' }, 'scale'],
    [{ mode: '99' }, 'mode'],
    [{ type: '99' }, 'type'],
    [{ from: 'abc' }, 'from'],
    [{ to: '8640000000000001' }, 'to'],
  ])('rejects %j', async (params, name) => {
    const response = await GET(apiRequest(PATH, params), {
      params: Promise.resolve({ username: USERNAME }),
    });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain(name);
    expect(mockedTopPartnersForPlayer).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown player', async () => {
    mockedTopPartnersForPlayer.mockResolvedValue(null);
    const response = await GET(apiRequest(PATH), {
      params: Promise.resolve({ username: USERNAME }),
    });
    expect(response.status).toBe(404);
  });
});
