import { NextRequest } from 'next/server';

import { AuthenticationError } from '@/actions/errors';
import type { FeedResult } from '@/actions/feed';

jest.mock('@/actions/feed', () => ({
  loadFeed: jest.fn(),
}));

import { loadFeed } from '@/actions/feed';
import { GET } from '@/api/feed/route';

const mockLoadFeed = loadFeed as jest.MockedFunction<typeof loadFeed>;

describe('GET /api/feed', () => {
  beforeEach(() => {
    mockLoadFeed.mockClear();
  });

  const createRequest = (params: Record<string, string> = {}) => {
    const url = new URL('http://localhost:3000/api/feed');
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    return new NextRequest(url);
  };

  it('should return feed items on success', async () => {
    const mockResult = {
      items: [{ type: 'session', id: 1, timestamp: new Date().toISOString() }],
      olderCursor: 'cursor123',
      newerCursor: null,
    } as unknown as FeedResult;
    mockLoadFeed.mockResolvedValue(mockResult);

    const request = createRequest();
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

    const request = createRequest({
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

  it('should default to older direction for invalid direction', async () => {
    mockLoadFeed.mockResolvedValue({
      items: [],
      olderCursor: null,
      newerCursor: null,
    });

    const request = createRequest({ direction: 'invalid' });
    await GET(request);

    expect(mockLoadFeed).toHaveBeenCalledWith({
      cursor: undefined,
      direction: 'older',
      limit: 20,
    });
  });

  it('should clamp limit to minimum of 1', async () => {
    mockLoadFeed.mockResolvedValue({
      items: [],
      olderCursor: null,
      newerCursor: null,
    });

    const request = createRequest({ limit: '0' });
    await GET(request);

    expect(mockLoadFeed).toHaveBeenCalledWith({
      cursor: undefined,
      direction: 'older',
      limit: 1,
    });
  });

  it('should clamp limit to maximum of 50', async () => {
    mockLoadFeed.mockResolvedValue({
      items: [],
      olderCursor: null,
      newerCursor: null,
    });

    const request = createRequest({ limit: '100' });
    await GET(request);

    expect(mockLoadFeed).toHaveBeenCalledWith({
      cursor: undefined,
      direction: 'older',
      limit: 50,
    });
  });

  it('should return 401 when user is not authenticated', async () => {
    mockLoadFeed.mockRejectedValue(new AuthenticationError());

    const request = createRequest();
    const response = await GET(request);

    expect(response.status).toBe(401);
    expect(response.body).toBeNull();
  });

  it('should return 500 for unexpected errors', async () => {
    mockLoadFeed.mockRejectedValue(new Error('Database error'));

    const request = createRequest();
    const response = await GET(request);

    expect(response.status).toBe(500);
    expect(response.body).toBeNull();
  });
});
