import { ChallengeMode } from '@blert/common';

jest.mock('@/actions/theatre', () => ({
  aggregateBloatDowns: jest.fn(),
}));
jest.mock('@/utils/metrics', () => ({
  observeHttpRequest: jest.fn(),
}));

import { aggregateBloatDowns } from '@/actions/theatre';
import { apiRequest } from '@/api/__tests__/request';

import { GET } from '../route';

const mockedAggregateBloatDowns = aggregateBloatDowns as jest.MockedFunction<
  typeof aggregateBloatDowns
>;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GET /api/v1/trends/bloat-downs', () => {
  it('queries without filters when none are provided', async () => {
    mockedAggregateBloatDowns.mockResolvedValue({
      totalDowns: 3,
      byWalkTicks: { '39': 1, '42': 2 },
    });
    const response = await GET(apiRequest('/api/v1/trends/bloat-downs'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      totalDowns: 3,
      byWalkTicks: { '39': 1, '42': 2 },
    });
    expect(mockedAggregateBloatDowns).toHaveBeenCalledWith({
      mode: undefined,
      scale: undefined,
      startTime: undefined,
      downNumber: undefined,
    });
  });

  it('parses and forwards provided filters', async () => {
    mockedAggregateBloatDowns.mockResolvedValue({
      totalDowns: 1,
      byWalkTicks: { '45': 1 },
    });
    const response = await GET(
      apiRequest('/api/v1/trends/bloat-downs', {
        mode: `${ChallengeMode.TOB_REGULAR},${ChallengeMode.TOB_HARD}`,
        scale: '1,5',
        startTime: '>=1789427000000',
        downNumber: '..3',
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      totalDowns: 1,
      byWalkTicks: { '45': 1 },
    });
    expect(mockedAggregateBloatDowns).toHaveBeenCalledWith({
      mode: [ChallengeMode.TOB_REGULAR, ChallengeMode.TOB_HARD],
      scale: [1, 5],
      startTime: ['>=', new Date(1789427000000)],
      downNumber: ['<', 3],
    });
  });

  it.each<[Record<string, string>, string]>([
    [{ mode: '99' }, 'mode'],
    [{ mode: '1,abc' }, 'mode'],
    [{ scale: '9' }, 'scale'],
    [{ scale: 'abc' }, 'scale'],
    [{ startTime: 'abc' }, 'startTime'],
    [{ startTime: '8640000000000001' }, 'startTime'],
    [{ downNumber: 'abc' }, 'downNumber'],
    [{ downNumber: '101' }, 'downNumber'],
  ])('rejects %j', async (params, name) => {
    const response = await GET(
      apiRequest('/api/v1/trends/bloat-downs', params),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain(name);
    expect(mockedAggregateBloatDowns).not.toHaveBeenCalled();
  });
});
