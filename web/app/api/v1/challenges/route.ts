import { SplitType } from '@blert/common';
import { NextRequest, NextResponse } from 'next/server';

import {
  ChallengeQuery,
  FindChallengesOptions,
  findChallenges,
} from '@/actions/challenge';
import { withApiRoute } from '@/api/handler';
import { parseIntParam } from '@/utils/params';

import { parseChallengeQueryParams } from './query';

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

const DEFAULT_SPLITS = [
  SplitType.COLOSSEUM_CHALLENGE,
  SplitType.COLOSSEUM_OVERALL,
  SplitType.TOB_CHALLENGE,
  SplitType.TOB_OVERALL,
];

/**
 * Extracts the split type from a string of the form "splits:<split>".
 * @param value The input string.
 * @returns The split type or null if the input is invalid.
 */
function parseSplit(value: string): SplitType | null {
  const parts = value.split(':');
  if (parts.length !== 2) {
    return null;
  }
  const split = parseInt(parts[1]) as SplitType;
  if (Number.isNaN(split)) {
    return null;
  }
  return split;
}

export const GET = withApiRoute(
  { route: '/api/v1/challenges' },
  async (request: NextRequest) => {
    const searchParams = request.nextUrl.searchParams;

    const limit = parseIntParam<number>(searchParams, 'limit') ?? DEFAULT_LIMIT;
    if (limit < 1 || limit > MAX_LIMIT) {
      return new Response(null, { status: 400 });
    }

    let query: ChallengeQuery;

    try {
      const q = parseChallengeQueryParams(searchParams);
      if (q === null) {
        return new Response(null, { status: 400 });
      }
      query = q;
    } catch {
      return new Response(null, { status: 400 });
    }

    const splits = new Set(DEFAULT_SPLITS);
    let loadStats = false;

    const extraFields = searchParams.get('extraFields')?.split(',');
    if (extraFields) {
      for (const field of extraFields) {
        if (field.startsWith('splits:')) {
          const split = parseSplit(field);
          if (split === null) {
            return new Response(null, { status: 400 });
          }
          splits.add(split);
        }
        if (field === 'stats') {
          loadStats = true;
        }
      }
    }

    // If requesting to sort by splits, ensure that the split values are included
    // in the result set.
    const sorts = searchParams.get('sort')?.split(',') ?? [];
    for (const sort of sorts) {
      const sortField = sort.slice(1).split('#')[0];
      if (sortField.startsWith('split:')) {
        const split = parseSplit(sortField);
        if (split === null) {
          return new Response(null, { status: 400 });
        }
        splits.add(split);
      }
    }

    const findOptions: Required<FindChallengesOptions> = {
      accurateSplits: false,
      fullRecordings: false,
      count: true,
      extraFields: {
        splits: Array.from(splits),
        stats: loadStats,
      },
    };

    const optionsParam = searchParams.get('options');
    if (optionsParam !== null) {
      const options = optionsParam.split(',');
      for (const option of options) {
        switch (option) {
          case 'accurateSplits':
            findOptions.accurateSplits = true;
            break;
          case 'fullRecordings':
            findOptions.fullRecordings = true;
            break;
          default:
            return new Response(null, { status: 400 });
        }
      }
    }

    const [challenges, count] = await findChallenges(limit, query, findOptions);
    if (challenges === null) {
      return new Response(null, { status: 404 });
    }
    return NextResponse.json(challenges, {
      headers: {
        'X-Total-Count': count ? count.toString() : '0',
      },
    });
  },
);
