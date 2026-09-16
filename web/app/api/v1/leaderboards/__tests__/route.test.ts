import { SplitType } from '@blert/common';

jest.mock('@/actions/challenge', () => ({
  findBestSplitTimes: jest.fn(),
}));
jest.mock('@/utils/metrics', () => ({
  observeHttpRequest: jest.fn(),
}));

import { findBestSplitTimes } from '@/actions/challenge';
import { apiRequest } from '@/api/__tests__/request';

import { GET } from '../route';

const mockedFindBestSplitTimes = findBestSplitTimes as jest.MockedFunction<
  typeof findBestSplitTimes
>;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GET /api/v1/leaderboards', () => {
  it('forwards requested splits, scale, and limits', async () => {
    const entry = {
      uuid: '25252525-2525-2525-2525-252525252525',
      date: new Date('2026-09-15T13:16:00.173Z'),
      ticks: 4188,
      party: [{ username: '1Ogp', currentUsername: '1Ogp' }],
      splitType: SplitType.TOB_REG_CHALLENGE,
      scale: 1,
      tieCount: 0,
    };
    mockedFindBestSplitTimes.mockResolvedValue({
      [SplitType.TOB_REG_CHALLENGE]: [entry],
    });
    const response = await GET(
      apiRequest('/api/v1/leaderboards', {
        splits: `${SplitType.TOB_REG_CHALLENGE}`,
        scale: '1',
        limit: '2',
        tiedTeamsLimit: '0',
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      [SplitType.TOB_REG_CHALLENGE]: [
        { ...entry, date: '2026-09-15T13:16:00.173Z' },
      ],
    });
    expect(mockedFindBestSplitTimes).toHaveBeenCalledWith(
      [SplitType.TOB_REG_CHALLENGE],
      1,
      2,
      undefined,
      0,
    );
  });

  it('defaults each limit to a reasonable value', async () => {
    mockedFindBestSplitTimes.mockResolvedValue({});
    const response = await GET(
      apiRequest('/api/v1/leaderboards', {
        splits: `${SplitType.TOB_REG_CHALLENGE}`,
        scale: '1',
        from: '1789478160173',
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({});
    expect(mockedFindBestSplitTimes).toHaveBeenCalledWith(
      [SplitType.TOB_REG_CHALLENGE],
      1,
      10,
      new Date(1789478160173),
      10,
    );
  });

  it.each<[Record<string, string>, string]>([
    [{}, 'splits'],
    [{ splits: '1' }, 'scale'],
    [{ splits: 'abc', scale: '5' }, 'splits'],
    [{ splits: '1,abc', scale: '5' }, 'splits'],
    [{ splits: '99999', scale: '5' }, 'splits'],
    [{ splits: '1', scale: 'abc' }, 'scale'],
    [{ splits: '1', scale: '9' }, 'scale'],
    [{ splits: '1', scale: '5', limit: '0' }, 'limit'],
    [{ splits: '1', scale: '5', limit: '101' }, 'limit'],
    [{ splits: '1', scale: '5', tiedTeamsLimit: '51' }, 'tiedTeamsLimit'],
    [{ splits: '1', scale: '5', tiedTeamsLimit: '-1' }, 'tiedTeamsLimit'],
    [{ splits: '1', scale: '5', from: 'abc' }, 'from'],
    [{ splits: '1', scale: '5', from: '8640000000000001' }, 'from'],
  ])('rejects %j', async (params, name) => {
    const response = await GET(apiRequest('/api/v1/leaderboards', params));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain(name);
    expect(mockedFindBestSplitTimes).not.toHaveBeenCalled();
  });
});
