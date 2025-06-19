import { NextRequest } from 'next/server';

import {
  aggregateBloatHands,
  BloatHandsQuery,
  BloatHandsView,
} from '@/actions/challenge';
import { numericComparatorParam } from '@/api/query';
import { parseChallengeQueryParams } from '../../challenges/query';

function isValidView(view: string): view is BloatHandsView {
  return ['total', 'wave', 'chunk', 'intraChunkOrder'].includes(view);
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  let query: BloatHandsQuery | null = null;
  try {
    query = parseChallengeQueryParams(searchParams);
    if (query === null) {
      return new Response(null, { status: 400 });
    }
  } catch (e: any) {
    console.error('Failed to parse challenge query:', e);
    return new Response(null, { status: 400 });
  }

  try {
    const searchParamsObj = Object.fromEntries(searchParams);
    query.wave = numericComparatorParam(searchParamsObj, 'wave');
    query.chunk = numericComparatorParam(searchParamsObj, 'chunk');
    query.intraChunkOrder = numericComparatorParam(
      searchParamsObj,
      'intraChunkOrder',
    );
  } catch (e: any) {
    console.error('Failed to parse bloat filters:', e);
    return new Response(null, { status: 400 });
  }

  const view = searchParams.get('view') ?? 'total';
  if (!isValidView(view)) {
    return new Response(null, { status: 400 });
  }

  try {
    const result = await aggregateBloatHands(query, view);
    if (result === null) {
      return new Response(null, { status: 404 });
    }
    return Response.json(result);
  } catch (e: any) {
    console.error('Failed to aggregate bloat hands:', e);
    return new Response(null, { status: 500 });
  }
}
