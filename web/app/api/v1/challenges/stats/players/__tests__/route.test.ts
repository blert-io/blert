import { ChallengeType } from '@blert/common';

jest.mock('@/actions/challenge', () => ({
  countUniquePlayers: jest.fn(),
}));
jest.mock('@/actions/player-challenges', () => ({
  countUniquePlayersForType: jest.fn(),
}));
jest.mock('@/utils/metrics', () => ({
  observeHttpRequest: jest.fn(),
}));

import { countUniquePlayers } from '@/actions/challenge';
import { countUniquePlayersForType } from '@/actions/player-challenges';
import { apiRequest } from '@/api/__tests__/request';
import { GET } from '@/api/v1/challenges/stats/players/route';

const mockedCountUniquePlayers = countUniquePlayers as jest.MockedFunction<
  typeof countUniquePlayers
>;
const mockedCountUniquePlayersForType =
  countUniquePlayersForType as jest.MockedFunction<
    typeof countUniquePlayersForType
  >;

describe('GET /api/v1/challenges/stats/players', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('forwards single-type requests to the view count', async () => {
    mockedCountUniquePlayersForType.mockResolvedValue(311);

    const response = await GET(
      apiRequest('/api/v1/challenges/stats/players', {
        type: String(ChallengeType.COLOSSEUM),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe(
      'public, max-age=3600, stale-while-revalidate=86400',
    );
    expect(await response.json()).toEqual({ count: 311 });
    expect(mockedCountUniquePlayersForType).toHaveBeenCalledWith(
      ChallengeType.COLOSSEUM,
    );
    expect(mockedCountUniquePlayers).not.toHaveBeenCalled();
  });

  it('forwards requests with other filters to the on-demand count', async () => {
    mockedCountUniquePlayers.mockResolvedValue(57);

    const response = await GET(
      apiRequest('/api/v1/challenges/stats/players', {
        type: String(ChallengeType.TOB),
        scale: '4',
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBeNull();
    expect(await response.json()).toEqual({ count: 57 });
    expect(mockedCountUniquePlayers).toHaveBeenCalledWith(
      expect.objectContaining({
        type: ['==', ChallengeType.TOB],
        scale: ['==', 4],
      }),
    );
    expect(mockedCountUniquePlayersForType).not.toHaveBeenCalled();
  });

  it('forwards multi-type requests to the on-demand count', async () => {
    mockedCountUniquePlayers.mockResolvedValue(1264);

    const response = await GET(
      apiRequest('/api/v1/challenges/stats/players', {
        type: `${ChallengeType.INFERNO},${ChallengeType.MOKHAIOTL}`,
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBeNull();
    expect(await response.json()).toEqual({ count: 1264 });
    expect(mockedCountUniquePlayers).toHaveBeenCalledWith(
      expect.objectContaining({
        type: ['in', [ChallengeType.INFERNO, ChallengeType.MOKHAIOTL]],
      }),
    );
    expect(mockedCountUniquePlayersForType).not.toHaveBeenCalled();
  });
});
