import { SplitType } from '@blert/common';
import { NextRequest, NextResponse } from 'next/server';

import { FindChallengesOptions, findChallenges } from '@/actions/challenge';
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
        const split = parseSplit(field);
        if (split === null) {
          return new Response(null, { status: 400 });
        }
        splits.add(split);
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

  const findOptions: FindChallengesOptions = {
    count: true,
    extraFields: {
      splits: Array.from(splits),
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
        default:
          return new Response(null, { status: 400 });
      }
    }
  }

  try {
    const [challenges, count] = await findChallenges(limit, query, findOptions);
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
