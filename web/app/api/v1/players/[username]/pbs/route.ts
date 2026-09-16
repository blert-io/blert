import { SplitType } from '@blert/common';
import { NextRequest } from 'next/server';

import { loadPbsForPlayer } from '@/actions/challenge';
import { withApiRoute } from '@/api/handler';
import { enumListParam, integerListParam } from '@/api/query';
import { requestParams } from '@/utils/url';

export const GET = withApiRoute(
  { route: '/api/v1/players/[username]/pbs' },
  async (request: NextRequest, { params }) => {
    const { username } = await params;
    const searchParams = requestParams(request.nextUrl.searchParams);

    const splits = enumListParam(SplitType, searchParams, 'split');
    const scales = integerListParam(searchParams, 'scale', 1, 8);

    const pbs = await loadPbsForPlayer(username, { splits, scales });
    if (pbs.length === 0) {
      return new Response(null, { status: 404 });
    }
    return Response.json(pbs);
  },
);
