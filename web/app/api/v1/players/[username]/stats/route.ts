import { NextRequest, NextResponse } from 'next/server';

import { getPlayerStatsHistory, PlayerStatsFilter } from '@/actions/challenge';
import { InvalidQueryError } from '@/actions/errors';
import { withApiRoute } from '@/api/handler';

export const GET = withApiRoute(
  { route: '/api/v1/players/[username]/stats' },
  async (request: NextRequest, { params }) => {
    const { username } = await params;
    const searchParams = request.nextUrl.searchParams;

    const filter: PlayerStatsFilter = {};

    const after = searchParams.get('after');
    if (after) {
      const date = new Date(after);
      if (isNaN(date.getTime())) {
        return NextResponse.json(
          { error: 'Invalid after date format' },
          { status: 400 },
        );
      }
      date.setUTCHours(0, 0, 0, 0);
      filter.after = date;
    }

    const before = searchParams.get('before');
    if (before) {
      const date = new Date(before);
      if (isNaN(date.getTime())) {
        return NextResponse.json(
          { error: 'Invalid before date format' },
          { status: 400 },
        );
      }
      date.setUTCHours(0, 0, 0, 0);
      filter.before = date;
    }

    let limit = undefined;
    const limitParam = searchParams.get('limit');
    if (limitParam) {
      limit = parseInt(limitParam, 10);
      if (isNaN(limit) || limit < 1) {
        return NextResponse.json(
          { error: 'Invalid limit value' },
          { status: 400 },
        );
      }
    }

    const which = searchParams.get('which');
    if (which) {
      filter.fields = which.split(',').map((f) => f.trim());
    }

    try {
      const stats = await getPlayerStatsHistory(username, limit, filter);
      return NextResponse.json(stats);
    } catch (error: any) {
      if (error instanceof InvalidQueryError) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      throw error;
    }
  },
);
