import { NextRequest } from 'next/server';

import { countUniquePlayers } from '@/actions/challenge';
import { countUniquePlayersForType } from '@/actions/player-challenges';
import { withApiRoute } from '@/api/handler';

import { parseChallengeQueryParams } from '../../query';

export const GET = withApiRoute(
  { route: '/api/v1/challenges/stats/players' },
  async (request: NextRequest) => {
    const searchParams = request.nextUrl.searchParams;

    const query = parseChallengeQueryParams(searchParams);

    const typeOnly = searchParams.keys().every((key) => key === 'type');
    if (typeOnly && query.type?.[0] === '==') {
      const count = await countUniquePlayersForType(query.type[1]);
      return Response.json(
        { count },
        {
          headers: {
            'Cache-Control':
              'public, max-age=3600, stale-while-revalidate=86400',
          },
        },
      );
    }

    const count = await countUniquePlayers(query);
    return Response.json({ count }, { status: 200 });
  },
);
