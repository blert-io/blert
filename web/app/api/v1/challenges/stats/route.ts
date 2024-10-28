import { NextRequest } from 'next/server';

import {
  ChallengeQuery,
  QueryOptions,
  aggregateChallenges,
} from '@/actions/challenge';
import { parseChallengeQueryParams } from '../query';

// import { loadAggregateChallengeStats } from '../../../../actions/challenge';

// export async function GET(request: NextRequest) {
//   const searchParams = request.nextUrl.searchParams;

//   const type = parseIntParam<ChallengeType>(searchParams, 'type');
//   const mode = parseIntParam<ChallengeMode>(searchParams, 'mode');

//   const challenges = await loadAggregateChallengeStats(type, mode);
//   if (challenges === null) {
//     return new Response(null, { status: 404 });
//   }
//   return Response.json(challenges);
// }

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  let query: ChallengeQuery;

  try {
    const q = parseChallengeQueryParams(searchParams);
    if (q === null) {
      return new Response(null, { status: 400 });
    }
    query = q;
  } catch (e: any) {
    console.error('Failed to parse invalid query:', e);
    return new Response(null, { status: 400 });
  }

  const options: QueryOptions = {};

  const optionsParam = searchParams.get('options');
  if (optionsParam !== null) {
    const opts = optionsParam.split(',');
    for (const opt of opts) {
      switch (opt) {
        case 'accurateSplits':
          options.accurateSplits = true;
          break;
        case 'fullRecordings':
          options.fullRecordings = true;
          break;
        default:
          return new Response(null, { status: 400 });
      }
    }
  }

  const result = await aggregateChallenges(query, { '*': 'count' }, options);
  if (result === null) {
    return new Response(null, { status: 404 });
  }

  return Response.json({
    count: result['*'].count,
  });
}
