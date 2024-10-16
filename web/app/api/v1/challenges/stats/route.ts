import { NextRequest } from 'next/server';

import { aggregateChallenges } from '@/actions/challenge';
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
  const query = parseChallengeQuery(request.nextUrl.searchParams);
  if (query === null) {
    return new Response(null, { status: 400 });
  }

  const result = await aggregateChallenges(query, { '*': 'count' });
  if (result === null) {
    return new Response(null, { status: 404 });
  }

  return Response.json({
    count: result['*'].count,
  });
}
