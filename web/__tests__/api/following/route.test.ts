import { NextRequest } from 'next/server';

import { AuthenticationError } from '@/actions/errors';
import type { FollowedPlayer, FollowingResult } from '@/actions/feed';

jest.mock('@/actions/feed', () => ({
  followPlayer: jest.fn(),
  getFollowing: jest.fn(),
}));

import { followPlayer, getFollowing } from '@/actions/feed';
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

  const createRequest = (params: Record<string, string> = {}) => {
    const url = new URL('http://localhost:3000/api/following');
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    return new NextRequest(url);
  };

  it('should return following list on success', async () => {
    const mockResult = {
      players: [{ id: 1, username: 'Player1' }],
      cursor: 'next-cursor',
      totalCount: 5,
    } as unknown as FollowingResult;
    mockGetFollowing.mockResolvedValue(mockResult);

    const request = createRequest();
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(mockResult);
    expect(mockGetFollowing).toHaveBeenCalledWith({
      cursor: undefined,
      limit: undefined,
    });
  });

  it('should pass query parameters to getFollowing', async () => {
    mockGetFollowing.mockResolvedValue({
      players: [],
      cursor: null,
      totalCount: 0,
    });

    const request = createRequest({ cursor: 'abc123', limit: '25' });
    await GET(request);

    expect(mockGetFollowing).toHaveBeenCalledWith({
      cursor: 'abc123',
      limit: 25,
    });
  });

  it('should return 400 for invalid query parameters', async () => {
    const request = createRequest({ limit: 'invalid' });
    const response = await GET(request);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('limit');
  });

  it('should return 401 when user is not authenticated', async () => {
    mockGetFollowing.mockRejectedValue(new AuthenticationError());

    const request = createRequest();
    const response = await GET(request);

    expect(response.status).toBe(401);
    expect(response.body).toBeNull();
  });

  it('should return 500 for unexpected errors', async () => {
    mockGetFollowing.mockRejectedValue(new Error('Database error'));

    const request = createRequest();
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

  it('should follow players and return results', async () => {
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

  it('should return 400 when usernames is not an array', async () => {
    const request = createRequest({ usernames: 'Player1' });
    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'Usernames array is required',
    });
  });

  it('should return 400 when usernames array is empty', async () => {
    const request = createRequest({ usernames: [] });
    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'Usernames array is required',
    });
  });

  it('should return 400 when usernames is missing', async () => {
    const request = createRequest({});
    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'Usernames array is required',
    });
  });

  it('should return 400 when more than 50 usernames', async () => {
    const usernames = Array.from({ length: 51 }, (_, i) => `Player${i}`);
    const request = createRequest({ usernames });
    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'Maximum 50 usernames per request',
    });
  });

  it('should return 400 when username is not a string', async () => {
    const request = createRequest({ usernames: [123] });
    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid username' });
  });

  it('should return 400 when username is empty', async () => {
    const request = createRequest({ usernames: [''] });
    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid username' });
  });

  it('should return 400 when username is longer than 12 characters', async () => {
    const request = createRequest({ usernames: ['ThisNameIsTooLong'] });
    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid username' });
  });

  it('should return 401 when user is not authenticated', async () => {
    mockFollowPlayer.mockRejectedValue(new AuthenticationError());

    const request = createRequest({ usernames: ['Player1'] });
    const response = await POST(request);

    expect(response.status).toBe(401);
    expect(response.body).toBeNull();
  });

  it('should return 500 for unexpected errors', async () => {
    mockFollowPlayer.mockRejectedValue(new Error('Database error'));

    const request = createRequest({ usernames: ['Player1'] });
    const response = await POST(request);

    expect(response.status).toBe(500);
    expect(response.body).toBeNull();
  });
});
