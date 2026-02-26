import { NextRequest } from 'next/server';

import {
  aggregateBloatHands,
  BloatHandsQuery,
  BloatHandsView,
} from '@/actions/challenge';
import { withApiRoute } from '@/api/handler';
import { numericComparatorParam } from '@/api/query';

import { parseChallengeQueryParams } from '../../challenges/query';

function isValidView(view: string): view is BloatHandsView {
  return ['total', 'wave', 'chunk', 'intraChunkOrder'].includes(view);
}

export const GET = withApiRoute(
  { route: '/api/v1/trends/bloat-hands' },
  async (request: NextRequest) => {
    const searchParams = request.nextUrl.searchParams;

    let query: BloatHandsQuery | null = null;
    try {
      query = parseChallengeQueryParams(searchParams);
      if (query === null) {
        return new Response(null, { status: 400 });
      }
    } catch {
      return new Response(null, { status: 400 });
    }

    const searchParamsObj = Object.fromEntries(searchParams);
    query.wave = numericComparatorParam(searchParamsObj, 'wave');
    query.chunk = numericComparatorParam(searchParamsObj, 'chunk');
    query.intraChunkOrder = numericComparatorParam(
      searchParamsObj,
      'intraChunkOrder',
    );

    const view = searchParams.get('view') ?? 'total';
    if (!isValidView(view)) {
      return new Response(null, { status: 400 });
    }

    const result = await aggregateBloatHands(query, view);
    if (result === null) {
      return new Response(null, { status: 404 });
    }
    return Response.json(result);
  },
);
