import { NextRequest } from 'next/server';

import { AuthenticationError } from '@/actions/errors';

jest.mock('@/actions/feed', () => ({
  unfollowPlayer: jest.fn(),
}));

import { unfollowPlayer } from '@/actions/feed';
import { DELETE } from '@/api/following/[playerId]/route';

const mockUnfollowPlayer = unfollowPlayer as jest.MockedFunction<
  typeof unfollowPlayer
>;

describe('DELETE /api/following/[playerId]', () => {
  beforeEach(() => {
    mockUnfollowPlayer.mockClear();
  });

  const createRequest = () => {
    return new NextRequest('http://localhost:3000/api/following/123', {
      method: 'DELETE',
    });
  };

  const createParams = (playerId: string) => ({
    params: Promise.resolve({ playerId }),
  });

  it('should unfollow player and return 204', async () => {
    mockUnfollowPlayer.mockResolvedValue(undefined);

    const request = createRequest();
    const response = await DELETE(request, createParams('123'));

    expect(response.status).toBe(204);
    expect(response.body).toBeNull();
    expect(mockUnfollowPlayer).toHaveBeenCalledWith(123);
  });

  it('should return 400 for invalid player ID', async () => {
    const request = createRequest();
    const response = await DELETE(request, createParams('invalid'));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid player ID' });
    expect(mockUnfollowPlayer).not.toHaveBeenCalled();
  });

  it('should return 400 for non-numeric player ID', async () => {
    const request = createRequest();
    const response = await DELETE(request, createParams('abc'));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid player ID' });
  });

  it('should return 400 for empty player ID', async () => {
    const request = createRequest();
    const response = await DELETE(request, createParams(''));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid player ID' });
  });

  it('should return 401 when user is not authenticated', async () => {
    mockUnfollowPlayer.mockRejectedValue(new AuthenticationError());

    const request = createRequest();
    const response = await DELETE(request, createParams('123'));

    expect(response.status).toBe(401);
    expect(response.body).toBeNull();
  });

  it('should return 500 for unexpected errors', async () => {
    mockUnfollowPlayer.mockRejectedValue(new Error('Database error'));

    const request = createRequest();
    const response = await DELETE(request, createParams('123'));

    expect(response.status).toBe(500);
    expect(response.body).toBeNull();
  });
});
