import { NextRequest, NextResponse } from 'next/server';

import { getPlayerStatsHistory, PlayerStatsFilter } from '@/actions/challenge';
import { withApiRoute } from '@/api/handler';
import { dateParam, expectSingle, integerParam } from '@/api/query';
import { requestParams } from '@/utils/url';

export const GET = withApiRoute(
  { route: '/api/v1/players/[username]/stats' },
  async (request: NextRequest, { params: path }) => {
    const { username } = await path;
    const params = requestParams(request.nextUrl.searchParams);

    const filter: PlayerStatsFilter = {};

    const after = dateParam(params, 'after');
    if (after !== undefined) {
      after.setUTCHours(0, 0, 0, 0);
      filter.after = after;
    }

    const before = dateParam(params, 'before');
    if (before !== undefined) {
      before.setUTCHours(0, 0, 0, 0);
      filter.before = before;
    }

    const limit = integerParam(params, 'limit', 1);

    const which = expectSingle(params, 'which');
    if (which !== undefined && which !== '') {
      filter.fields = which.split(',').map((f) => f.trim());
    }

    const stats = await getPlayerStatsHistory(username, limit, filter);
    return NextResponse.json(stats);
  },
);
