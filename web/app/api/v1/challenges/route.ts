import {
  ChallengeMode,
  ChallengeStatus,
  ChallengeType,
  SplitType,
} from '@blert/common';
import { NextRequest } from 'next/server';

import { ChallengeQuery, findChallenges } from '@/actions/challenge';
import { parseArrayParam, parseIntParam } from '@/utils/params';
import { Comparator, Operator } from '@/actions/query';

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

const SPLIT_REGEX = /^(\d+)(lt|gt|lte|gte|eq|ne|>|<|>=|<=|=|==|!=)(\d+)$/;

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  const limit = parseIntParam<number>(searchParams, 'limit') ?? DEFAULT_LIMIT;
  if (limit < 1 || limit > MAX_LIMIT) {
    return new Response(null, { status: 400 });
  }

  const party = searchParams.get('party')?.split(',') ?? undefined;

  const sort = searchParams.get('sort') ?? undefined;
  if (sort !== undefined) {
    if (sort[0] !== '-' && sort[0] !== '+') {
      return new Response(null, { status: 400 });
    }
  }

  const splits: Array<Comparator<SplitType, number>> = [];
  for (const s of searchParams.getAll('split')) {
    const match = s.match(SPLIT_REGEX);

    if (match === null) {
      return new Response(null, { status: 400 });
    }

    splits.push([
      parseInt(match[1]) as SplitType,
      match[2] as Operator,
      parseInt(match[3]),
    ]);
  }

  const query: ChallengeQuery = {
    type: parseIntParam<ChallengeType>(searchParams, 'type'),
    mode: parseIntParam<ChallengeMode>(searchParams, 'mode'),
    status: parseArrayParam<ChallengeStatus>(searchParams, 'status'),
    scale: parseIntParam<number>(searchParams, 'scale'),
    party,
    splits,
    sort: sort as ChallengeQuery['sort'],
  };

  try {
    const challenges = await findChallenges(limit, query);
    if (challenges === null) {
      return new Response(null, { status: 404 });
    }
    return Response.json(challenges);
  } catch (e: any) {
    if (e.name === 'InvalidQueryError') {
      return new Response(null, { status: 400 });
    }

    console.error('Failed to find challenges:', e);
    return new Response(null, { status: 500 });
  }
}
