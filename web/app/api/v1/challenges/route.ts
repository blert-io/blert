import { NextRequest, NextResponse } from 'next/server';

import { findChallenges } from '@/actions/challenge';
import { parseIntParam } from '@/utils/params';

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

import { parseChallengeQuery } from './query';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  const limit = parseIntParam<number>(searchParams, 'limit') ?? DEFAULT_LIMIT;
  if (limit < 1 || limit > MAX_LIMIT) {
    return new Response(null, { status: 400 });
  }

  const query = parseChallengeQuery(searchParams);
  if (query === null) {
    return new Response(null, { status: 400 });
  }

  try {
    const [challenges, count] = await findChallenges(limit, query, true);
    if (challenges === null) {
      return new Response(null, { status: 404 });
    }
    return NextResponse.json(challenges, {
      headers: {
        'X-Total-Count': count ? count.toString() : '0',
      },
    });
  } catch (e: any) {
    if (e.name === 'InvalidQueryError') {
      return new Response(null, { status: 400 });
    }

    console.error('Failed to find challenges:', e);
    return new Response(null, { status: 500 });
  }
}
