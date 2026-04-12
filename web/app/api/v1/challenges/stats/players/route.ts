import { NextRequest } from 'next/server';

import { ChallengeQuery, countUniquePlayers } from '@/actions/challenge';
import { withApiRoute } from '@/api/handler';

import { parseChallengeQueryParams } from '../../query';

export const GET = withApiRoute(
  { route: '/api/v1/challenges/stats/players' },
  async (request: NextRequest) => {
    const searchParams = request.nextUrl.searchParams;

    let query: ChallengeQuery;

    try {
      const q = parseChallengeQueryParams(searchParams);
      if (q === null) {
        return new Response(null, { status: 400 });
      }
      query = q;
    } catch {
      return new Response(null, { status: 400 });
    }

    const count = await countUniquePlayers(query);
    return Response.json({ count });
  },
);
