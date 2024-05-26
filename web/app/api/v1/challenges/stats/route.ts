import { ChallengeMode, ChallengeType } from '@blert/common';
import { NextRequest } from 'next/server';

import { loadAggregateChallengeStats } from '../../../../actions/challenge';
import { parseIntParam } from '../../../../utils/params';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  const type = parseIntParam<ChallengeType>(searchParams, 'type');
  const mode = parseIntParam<ChallengeMode>(searchParams, 'mode');

  const challenges = await loadAggregateChallengeStats(type, mode);
  if (challenges === null) {
    return new Response(null, { status: 404 });
  }
  return Response.json(challenges);
}
