import { ChallengeType } from '@blert/common';
import { NextRequest } from 'next/server';

import { loadRecentChallenges } from '../../../actions/challenge';
import { parseIntParam } from '../../../utils/params';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  const limit = parseIntParam<number>(searchParams, 'limit');
  if (limit === undefined) {
    return new Response(null, { status: 400 });
  }

  const type = parseIntParam<ChallengeType>(searchParams, 'type');
  const username = searchParams.get('username') ?? undefined;

  const challenges = await loadRecentChallenges(limit, type, username);
  if (challenges === null) {
    return new Response(null, { status: 404 });
  }
  return Response.json(challenges);
}
