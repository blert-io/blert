import { NextResponse } from 'next/server';

import { loadPlayerWithStats } from '@/actions/challenge';
import { withApiRoute } from '@/api/handler';

export const GET = withApiRoute(
  { route: '/api/v1/players/[username]' },
  async (_, { params }) => {
    const { username } = await params;

    const player = await loadPlayerWithStats(username);
    if (player === null) {
      return NextResponse.json({ error: 'Player not found' }, { status: 404 });
    }

    return NextResponse.json(player);
  },
);
