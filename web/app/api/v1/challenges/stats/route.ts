import { NextRequest } from 'next/server';

import { QueryOptions, aggregateChallenges } from '@/actions/challenge';
import { parseChallengeQuery } from '../query';

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

  const query = parseChallengeQuery(searchParams);
  if (query === null) {
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
