import { ChallengeType } from '@blert/common';

jest.mock('@/actions/activity', () => ({
  getPlayersPerHour: jest.fn(),
  playerActivityByHour: jest.fn(),
}));
jest.mock('@/utils/metrics', () => ({
  observeHttpRequest: jest.fn(),
}));

import { getPlayersPerHour, playerActivityByHour } from '@/actions/activity';
import { apiRequest } from '@/api/__tests__/request';

import { GET } from '../route';

const mockedGetPlayersPerHour = getPlayersPerHour as jest.MockedFunction<
  typeof getPlayersPerHour
>;
const mockedPlayerActivityByHour = playerActivityByHour as jest.MockedFunction<
  typeof playerActivityByHour
>;

const NOW = 1789478160173;
const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers({ now: NOW });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('GET /api/activity/players', () => {
  it('defaults period to a day', async () => {
    const hours = [
      0, 0, 0, 1, 4, 3, 0, 0, 5, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ];
    mockedGetPlayersPerHour.mockResolvedValue(hours);
    const response = await GET(apiRequest('/api/activity/players'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(hours);
    expect(mockedGetPlayersPerHour).toHaveBeenCalledWith(
      new Date(NOW - DAY),
      undefined,
    );
  });

  it('forwards period start and challenge type', async () => {
    const hours = [
      8, 576, 478, 420, 491, 384, 252, 134, 72, 41, 53, 50, 136, 407, 287, 323,
      587, 643, 630, 614, 569, 427, 444, 519, 546,
    ];
    mockedGetPlayersPerHour.mockResolvedValue(hours);
    const response = await GET(
      apiRequest('/api/activity/players', {
        period: 'all',
        type: `${ChallengeType.TOB}`,
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(hours);
    expect(mockedGetPlayersPerHour).toHaveBeenCalledWith(
      new Date(0),
      ChallengeType.TOB,
    );
  });

  it('queries one player when username is given', async () => {
    const hours = [
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 0, 0, 0,
    ];
    mockedPlayerActivityByHour.mockResolvedValue(hours);
    const response = await GET(
      apiRequest('/api/activity/players', { username: '1Ogp', period: 'week' }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(hours);
    expect(mockedPlayerActivityByHour).toHaveBeenCalledWith(
      '1Ogp',
      new Date(NOW - 7 * DAY),
    );
    expect(mockedGetPlayersPerHour).not.toHaveBeenCalled();
  });

  it.each<[Record<string, string>, string]>([
    [{ period: 'abc' }, 'period'],
    [{ period: '' }, 'period'],
    [{ type: '99' }, 'type'],
    [{ type: 'abc' }, 'type'],
  ])('rejects %j', async (params, name) => {
    const response = await GET(apiRequest('/api/activity/players', params));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain(name);
    expect(mockedGetPlayersPerHour).not.toHaveBeenCalled();
    expect(mockedPlayerActivityByHour).not.toHaveBeenCalled();
  });
});
