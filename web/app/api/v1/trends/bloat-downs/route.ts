import { ChallengeMode } from '@blert/common';
import { NextRequest } from 'next/server';

import { aggregateBloatDowns, BloatDownsQuery } from '@/actions/theatre';
import { withApiRoute } from '@/api/handler';
import {
  dateComparatorParam,
  expectSingle,
  numericComparatorParam,
} from '@/api/query';

export const GET = withApiRoute(
  { route: '/api/v1/trends/bloat-downs' },
  async (request: NextRequest) => {
    const searchParams = Object.fromEntries(request.nextUrl.searchParams);

    const query: BloatDownsQuery = {};

    const mode = expectSingle(searchParams, 'mode');
    if (mode !== undefined) {
      query.mode = mode
        .split(',')
        .map((m) => parseInt(m))
        .filter((m) => !isNaN(m)) as ChallengeMode[];
    }

    const scale = expectSingle(searchParams, 'scale');
    if (scale !== undefined) {
      query.scale = scale
        .split(',')
        .map((s) => parseInt(s))
        .filter((s) => !isNaN(s));
    }

    try {
      query.startTime = dateComparatorParam(searchParams, 'startTime');
      query.downNumber = numericComparatorParam(searchParams, 'downNumber');
    } catch {
      return new Response(null, { status: 400 });
    }

    const result = await aggregateBloatDowns(query);
    return Response.json(result);
  },
);
