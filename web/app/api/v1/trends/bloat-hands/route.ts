import { ChallengeMode } from '@blert/common';
import { NextRequest } from 'next/server';

import { aggregateBloatHands, BloatHandsQuery } from '@/actions/bloat-hands';
import { withApiRoute } from '@/api/handler';
import { dateComparatorParam, expectSingle } from '@/api/query';

export const GET = withApiRoute(
  { route: '/api/v1/trends/bloat-hands' },
  async (request: NextRequest) => {
    const searchParams = Object.fromEntries(request.nextUrl.searchParams);

    const query: BloatHandsQuery = {};

    const mode = expectSingle(searchParams, 'mode');
    if (mode !== undefined) {
      query.mode = mode
        .split(',')
        .map((m) => parseInt(m))
        .filter((m) => !isNaN(m)) as ChallengeMode[];
    }

    const order = expectSingle(searchParams, 'intraChunkOrder');
    if (order !== undefined) {
      const parsed = parseInt(order);
      if (isNaN(parsed)) {
        return new Response(null, { status: 400 });
      }
      query.intraChunkOrder = parsed;
    }

    try {
      query.startTime = dateComparatorParam(searchParams, 'startTime');
    } catch {
      return new Response(null, { status: 400 });
    }

    const result = await aggregateBloatHands(query);
    return Response.json(result);
  },
);
