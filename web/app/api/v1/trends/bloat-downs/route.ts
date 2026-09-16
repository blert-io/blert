import { ChallengeMode } from '@blert/common';
import { NextRequest } from 'next/server';

import { aggregateBloatDowns, BloatDownsQuery } from '@/actions/theatre';
import { withApiRoute } from '@/api/handler';
import {
  dateComparatorParam,
  enumListParam,
  integerComparatorParam,
  integerListParam,
} from '@/api/query';
import { requestParams } from '@/utils/url';

export const GET = withApiRoute(
  { route: '/api/v1/trends/bloat-downs' },
  async (request: NextRequest) => {
    const params = requestParams(request.nextUrl.searchParams);

    const query: BloatDownsQuery = {
      mode: enumListParam(ChallengeMode, params, 'mode'),
      scale: integerListParam(params, 'scale', 1, 8),
      startTime: dateComparatorParam(params, 'startTime'),
      downNumber: integerComparatorParam(params, 'downNumber', 0, 100),
    };

    const result = await aggregateBloatDowns(query);
    return Response.json(result);
  },
);
