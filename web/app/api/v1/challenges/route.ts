import { SplitType } from '@blert/common';
import { NextRequest, NextResponse } from 'next/server';

import { findChallenges } from '@/actions/challenge';
import { parseIntParam } from '@/utils/params';

import { parseChallengeQuery } from './query';

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

const DEFAULT_SPLITS = [
  SplitType.COLOSSEUM_CHALLENGE,
  SplitType.COLOSSEUM_OVERALL,
  SplitType.TOB_CHALLENGE,
  SplitType.TOB_OVERALL,
];

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

  const splits = new Set(DEFAULT_SPLITS);

  const extraFields = searchParams.get('extraFields')?.split(',');
  if (extraFields) {
    for (const field of extraFields) {
      if (field.startsWith('splits:')) {
        const parts = field.split(':');
        if (parts.length !== 2) {
          return new Response(null, { status: 400 });
        }
        const split = parseInt(parts[1]) as SplitType;
        if (Number.isNaN(split)) {
          return new Response(null, { status: 400 });
        }
        splits.add(split);
      }
    }
  }

  try {
    const [challenges, count] = await findChallenges(limit, query, {
      count: true,
      extraFields: {
        splits: Array.from(splits),
      },
    });
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
