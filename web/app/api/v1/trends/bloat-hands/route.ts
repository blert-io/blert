import { ChallengeMode } from '@blert/common';
import { NextRequest } from 'next/server';

import { aggregateBloatHands, BloatHandsQuery } from '@/actions/theatre';
import { withApiRoute } from '@/api/handler';
import { dateComparatorParam, enumListParam, integerParam } from '@/api/query';
import { requestParams } from '@/utils/url';

export const GET = withApiRoute(
  { route: '/api/v1/trends/bloat-hands' },
  async (request: NextRequest) => {
    const params = requestParams(request.nextUrl.searchParams);

    const query: BloatHandsQuery = {
      mode: enumListParam(ChallengeMode, params, 'mode'),
      startTime: dateComparatorParam(params, 'startTime'),
      intraChunkOrder: integerParam(params, 'intraChunkOrder', 0),
    };

    const result = await aggregateBloatHands(query);
    return Response.json(result);
  },
);
