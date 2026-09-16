import { SplitType } from '@blert/common';
import { NextRequest } from 'next/server';

import { findBestSplitTimes } from '@/actions/challenge';
import { InvalidQueryError } from '@/actions/errors';
import { withApiRoute } from '@/api/handler';
import { dateParam, enumListParam, integerParam } from '@/api/query';
import { requestParams } from '@/utils/url';

export const GET = withApiRoute(
  { route: '/api/v1/leaderboards' },
  async (request: NextRequest) => {
    const params = requestParams(request.nextUrl.searchParams);

    const splits = enumListParam(SplitType, params, 'splits');
    if (splits === undefined) {
      throw new InvalidQueryError('Missing splits');
    }
    const scale = integerParam(params, 'scale', 1, 8);
    if (scale === undefined) {
      throw new InvalidQueryError('Missing scale');
    }
    const limit = integerParam(params, 'limit', 1, 100) ?? 10;
    const tiedTeamsLimit = integerParam(params, 'tiedTeamsLimit', 0, 50) ?? 10;
    const startTime = dateParam(params, 'from');

    const rankedSplits = await findBestSplitTimes(
      splits,
      scale,
      limit,
      startTime,
      tiedTeamsLimit,
    );
    return Response.json(rankedSplits);
  },
);
