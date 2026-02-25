import { NextRequest } from 'next/server';

import { AuthenticationError } from '@/actions/errors';
import { unfollowPlayer } from '@/actions/feed';
import { withApiRoute } from '@/api/handler';

export const DELETE = withApiRoute(
  { route: '/api/following/[playerId]' },
  async (_request: NextRequest, { params }) => {
    const { playerId: playerIdStr } = await params;
    const playerId = parseInt(playerIdStr, 10);

    if (isNaN(playerId)) {
      return Response.json({ error: 'Invalid player ID' }, { status: 400 });
    }

    try {
      await unfollowPlayer(playerId);
      return new Response(null, { status: 204 });
    } catch (error) {
      if (error instanceof AuthenticationError) {
        return new Response(null, { status: 401 });
      }
      throw error;
    }
  },
);
