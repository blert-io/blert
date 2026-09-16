jest.mock('@/actions/activity', () => ({
  getRecentFeedItems: jest.fn(),
}));
jest.mock('@/utils/metrics', () => ({
  observeHttpRequest: jest.fn(),
}));

import { getRecentFeedItems } from '@/actions/activity';
import { apiRequest } from '@/api/__tests__/request';

import { GET } from '../route';

const mockedGetRecentFeedItems = getRecentFeedItems as jest.MockedFunction<
  typeof getRecentFeedItems
>;

beforeEach(() => {
  jest.clearAllMocks();
  mockedGetRecentFeedItems.mockResolvedValue([]);
});

describe('GET /api/activity/feed', () => {
  it('defaults limit to 10', async () => {
    const response = await GET(apiRequest('/api/activity/feed'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
    expect(mockedGetRecentFeedItems).toHaveBeenCalledWith(10);
  });

  it('forwards limit', async () => {
    const response = await GET(
      apiRequest('/api/activity/feed', { limit: '2' }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
    expect(mockedGetRecentFeedItems).toHaveBeenCalledWith(2);
  });

  it.each(['0', '101', 'abc', ''])('rejects limit %s', async (limit) => {
    const response = await GET(apiRequest('/api/activity/feed', { limit }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('limit');
    expect(mockedGetRecentFeedItems).not.toHaveBeenCalled();
  });
});
