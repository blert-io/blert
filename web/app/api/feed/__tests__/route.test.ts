import { AuthenticationError } from '@/actions/errors';
import type { FeedResult } from '@/actions/feed';

jest.mock('@/actions/feed', () => ({
  loadFeed: jest.fn(),
}));

import { loadFeed } from '@/actions/feed';
import { apiRequest } from '@/api/__tests__/request';
import { GET } from '@/api/feed/route';

const mockLoadFeed = loadFeed as jest.MockedFunction<typeof loadFeed>;

describe('GET /api/feed', () => {
  beforeEach(() => {
    mockLoadFeed.mockClear();
  });

  it('returns feed items on success', async () => {
    const mockResult = {
      items: [{ type: 'session', id: 1, timestamp: new Date().toISOString() }],
      olderCursor: 'cursor123',
      newerCursor: null,
    } as unknown as FeedResult;
    mockLoadFeed.mockResolvedValue(mockResult);

    const request = apiRequest('/api/feed');
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(mockResult);
    expect(mockLoadFeed).toHaveBeenCalledWith({
      cursor: undefined,
      direction: 'older',
      limit: 20,
    });
  });

  it('should pass query parameters to loadFeed', async () => {
    mockLoadFeed.mockResolvedValue({
      items: [],
      olderCursor: null,
      newerCursor: null,
    });

    const request = apiRequest('/api/feed', {
      cursor: 'abc123',
      direction: 'newer',
      limit: '30',
    });
    await GET(request);

    expect(mockLoadFeed).toHaveBeenCalledWith({
      cursor: 'abc123',
      direction: 'newer',
      limit: 30,
    });
  });

  it('defaults to older direction for invalid direction', async () => {
    mockLoadFeed.mockResolvedValue({
      items: [],
      olderCursor: null,
      newerCursor: null,
    });

    const request = apiRequest('/api/feed', { direction: 'invalid' });
    await GET(request);

    expect(mockLoadFeed).toHaveBeenCalledWith({
      cursor: undefined,
      direction: 'older',
      limit: 20,
    });
  });

  it.each(['0', '100', 'abc'])('rejects limit %s', async (limit) => {
    const response = await GET(apiRequest('/api/feed', { limit }));

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('limit');
    expect(mockLoadFeed).not.toHaveBeenCalled();
  });

  it('returns 401 when user is not authenticated', async () => {
    mockLoadFeed.mockRejectedValue(new AuthenticationError());

    const request = apiRequest('/api/feed');
    const response = await GET(request);

    expect(response.status).toBe(401);
    expect(response.body).toBeNull();
  });

  it('returns 500 for unexpected errors', async () => {
    mockLoadFeed.mockRejectedValue(new Error('Database error'));

    const request = apiRequest('/api/feed');
    const response = await GET(request);

    expect(response.status).toBe(500);
    expect(response.body).toBeNull();
  });
});
