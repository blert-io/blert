import { ChallengeMode } from '@blert/common';

jest.mock('@/actions/theatre', () => ({
  aggregateBloatHands: jest.fn(),
}));
jest.mock('@/utils/metrics', () => ({
  observeHttpRequest: jest.fn(),
}));

import { aggregateBloatHands } from '@/actions/theatre';
import { apiRequest } from '@/api/__tests__/request';

import { GET } from '../route';

const mockedAggregateBloatHands = aggregateBloatHands as jest.MockedFunction<
  typeof aggregateBloatHands
>;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GET /api/v1/trends/bloat-hands', () => {
  it('queries without filters when none are provided', async () => {
    const hands = { totalChallenges: 2, totalHands: 1014, byTile: { '76': 2 } };
    mockedAggregateBloatHands.mockResolvedValue(hands);
    const response = await GET(apiRequest('/api/v1/trends/bloat-hands'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(hands);
    expect(mockedAggregateBloatHands).toHaveBeenCalledWith({
      mode: undefined,
      startTime: undefined,
      intraChunkOrder: undefined,
    });
  });

  it('parses and forwards provided filters', async () => {
    const hands = { totalChallenges: 1, totalHands: 159, byTile: { '44': 1 } };
    mockedAggregateBloatHands.mockResolvedValue(hands);
    const response = await GET(
      apiRequest('/api/v1/trends/bloat-hands', {
        mode: `${ChallengeMode.TOB_REGULAR}`,
        startTime: '1782640000000..1782700000000',
        intraChunkOrder: '4',
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(hands);
    expect(mockedAggregateBloatHands).toHaveBeenCalledWith({
      mode: [ChallengeMode.TOB_REGULAR],
      startTime: ['range', [new Date(1782640000000), new Date(1782700000000)]],
      intraChunkOrder: 4,
    });
  });

  it.each<[Record<string, string>, string]>([
    [{ mode: '99' }, 'mode'],
    [{ mode: '1,abc' }, 'mode'],
    [{ startTime: 'abc' }, 'startTime'],
    [{ intraChunkOrder: 'abc' }, 'intraChunkOrder'],
    [{ intraChunkOrder: '-1' }, 'intraChunkOrder'],
    [{ intraChunkOrder: '1.5' }, 'intraChunkOrder'],
  ])('rejects %j', async (params, name) => {
    const response = await GET(
      apiRequest('/api/v1/trends/bloat-hands', params),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain(name);
    expect(mockedAggregateBloatHands).not.toHaveBeenCalled();
  });
});
