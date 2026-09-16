import { NextRequest } from 'next/server';

import { AuthenticationError } from '@/actions/errors';
import type { FollowedPlayer, FollowingResult } from '@/actions/feed';

jest.mock('@/actions/feed', () => ({
  followPlayer: jest.fn(),
  getFollowing: jest.fn(),
}));

import { followPlayer, getFollowing } from '@/actions/feed';
import { apiRequest } from '@/api/__tests__/request';
import { GET, POST } from '@/api/following/route';

const mockFollowPlayer = followPlayer as jest.MockedFunction<
  typeof followPlayer
>;
const mockGetFollowing = getFollowing as jest.MockedFunction<
  typeof getFollowing
>;

describe('GET /api/following', () => {
  beforeEach(() => {
    mockGetFollowing.mockClear();
  });

  it('returns following list on success', async () => {
    const mockResult = {
      players: [{ id: 1, username: 'Player1' }],
      cursor: 'next-cursor',
      totalCount: 5,
    } as unknown as FollowingResult;
    mockGetFollowing.mockResolvedValue(mockResult);

    const request = apiRequest('/api/following');
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(mockResult);
    expect(mockGetFollowing).toHaveBeenCalledWith({
      cursor: undefined,
      limit: undefined,
    });
  });

  it('forwards query parameters to getFollowing', async () => {
    mockGetFollowing.mockResolvedValue({
      players: [],
      cursor: null,
      totalCount: 0,
    });

    const request = apiRequest('/api/following', {
      cursor: 'abc123',
      limit: '25',
    });
    await GET(request);

    expect(mockGetFollowing).toHaveBeenCalledWith({
      cursor: 'abc123',
      limit: 25,
    });
  });

  it('returns 400 for invalid query parameters', async () => {
    const request = apiRequest('/api/following', { limit: 'invalid' });
    const response = await GET(request);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('limit');
  });

  it('returns 401 when user is not authenticated', async () => {
    mockGetFollowing.mockRejectedValue(new AuthenticationError());

    const request = apiRequest('/api/following');
    const response = await GET(request);

    expect(response.status).toBe(401);
    expect(response.body).toBeNull();
  });

  it('returns 500 for unexpected errors', async () => {
    mockGetFollowing.mockRejectedValue(new Error('Database error'));

    const request = apiRequest('/api/following');
    const response = await GET(request);

    expect(response.status).toBe(500);
    expect(response.body).toBeNull();
  });
});

describe('POST /api/following', () => {
  beforeEach(() => {
    mockFollowPlayer.mockClear();
  });

  const createRequest = (body: unknown) => {
    return new NextRequest('http://localhost:3000/api/following', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  };

  it('follows players and returns the results', async () => {
    const mockPlayer = {
      id: 1,
      username: 'Player1',
    } as unknown as FollowedPlayer;
    mockFollowPlayer.mockResolvedValue(mockPlayer);

    const request = createRequest({ usernames: ['Player1', 'Player2'] });
    const response = await POST(request);

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual([mockPlayer, mockPlayer]);
    expect(mockFollowPlayer).toHaveBeenCalledTimes(2);
    expect(mockFollowPlayer).toHaveBeenCalledWith('Player1');
    expect(mockFollowPlayer).toHaveBeenCalledWith('Player2');
  });

  it('returns 400 when usernames is not an array of names', async () => {
    let response = await POST(createRequest({ usernames: 'Player1' }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'Usernames array is required',
    });

    response = await POST(createRequest({ usernames: [] }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'Usernames array is required',
    });

    response = await POST(createRequest({}));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'Usernames array is required',
    });
  });

  it('returns 400 for more than 50 usernames', async () => {
    const usernames = Array.from({ length: 51 }, (_, i) => `Player${i}`);
    const request = createRequest({ usernames });
    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'Maximum 50 usernames per request',
    });
  });

  it('returns 400 when a username is invalid', async () => {
    let response = await POST(createRequest({ usernames: [123] }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid username' });

    response = await POST(createRequest({ usernames: [''] }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid username' });

    response = await POST(createRequest({ usernames: ['over_12_characters'] }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid username' });
  });

  it('returns 401 when user is not authenticated', async () => {
    mockFollowPlayer.mockRejectedValue(new AuthenticationError());

    const request = createRequest({ usernames: ['Player1'] });
    const response = await POST(request);

    expect(response.status).toBe(401);
    expect(response.body).toBeNull();
  });

  it('returns 500 for unexpected errors', async () => {
    mockFollowPlayer.mockRejectedValue(new Error('Database error'));

    const request = createRequest({ usernames: ['Player1'] });
    const response = await POST(request);

    expect(response.status).toBe(500);
    expect(response.body).toBeNull();
  });
});
