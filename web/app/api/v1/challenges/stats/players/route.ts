import { ChallengeMode, ChallengeType } from '@blert/common';
import { NextRequest } from 'next/server';

import {
  ChallengeQuery,
  countUniquePlayers,
  SingleOrArray,
} from '@/actions/challenge';
import { Comparator } from '@/actions/query';
import { cachedRaw } from '@/api/cache';
import { withApiRoute } from '@/api/handler';

import { parseChallengeQueryParams } from '../../query';

const cachedCountUniquePlayers = cachedRaw(
  { name: 'challenges:stats:players' },
  (_: ChallengeQuery, params: string) => params,
  async (query: ChallengeQuery, _params: string) => ({
    count: await countUniquePlayers(query),
  }),
);

const CACHEABLE_PARAMS = new Set<keyof ChallengeQuery>([
  'type',
  'mode',
  'scale',
]);
const CACHEABLE_TYPES = numericEnumValues(ChallengeType);
const CACHEABLE_MODES = numericEnumValues(ChallengeMode);
const CACHEABLE_SCALES = new Set([1, 2, 3, 4, 5]);

function numericEnumValues(enumObject: object): Set<number> {
  return new Set(
    Object.values(enumObject).filter(
      (value): value is number => typeof value === 'number',
    ),
  );
}

function normalizeNumericList(
  value: SingleOrArray<number>,
  allowedValues: ReadonlySet<number>,
): string | null {
  const values = Array.isArray(value) ? value : [value];
  if (values.length === 0) {
    return null;
  }

  const numbers = new Set<number>();
  for (const v of values) {
    if (!allowedValues.has(v)) {
      return null;
    }
    numbers.add(v);
  }

  return Array.from(numbers).sort().join(',');
}

function normalizeComparatorParam(
  value: Comparator<number>,
  allowedValues: ReadonlySet<number>,
): string | null {
  if (value[0] === 'in') {
    return normalizeNumericList(value[1], allowedValues);
  }

  if (value[0] === 'range') {
    const [start, end] = value[1];
    if (allowedValues.has(start) && allowedValues.has(end)) {
      return `${start}..${end}`;
    }
    return null;
  }

  const [op, val] = value;
  if (allowedValues.has(val)) {
    return `${op}${val}`;
  }
  return null;
}

function cacheKey(
  params: URLSearchParams,
  query: ChallengeQuery,
): string | null {
  // Only cache a small set of filters which return broad, stable counts.
  if (
    !params
      .keys()
      .every((key) => CACHEABLE_PARAMS.has(key as keyof ChallengeQuery))
  ) {
    return null;
  }

  const key = new URLSearchParams();
  for (const param of CACHEABLE_PARAMS) {
    let normalized: string | null;
    const value = query[param];
    if (value === undefined) {
      continue;
    }

    switch (param) {
      case 'type':
        normalized = normalizeComparatorParam(
          value as Required<ChallengeQuery>['type'],
          CACHEABLE_TYPES,
        );
        break;
      case 'mode':
        normalized = normalizeNumericList(
          value as Required<ChallengeQuery>['mode'],
          CACHEABLE_MODES,
        );
        break;
      case 'scale':
        normalized = normalizeComparatorParam(
          value as Required<ChallengeQuery>['scale'],
          CACHEABLE_SCALES,
        );
        break;
      default:
        continue;
    }

    if (normalized === null) {
      return null;
    }

    key.set(param, normalized);
  }

  key.sort();
  return key.toString();
}

export const GET = withApiRoute(
  { route: '/api/v1/challenges/stats/players' },
  async (request: NextRequest) => {
    const searchParams = request.nextUrl.searchParams;

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

    const key = cacheKey(searchParams, query);
    if (key === null) {
      const count = await countUniquePlayers(query);
      return Response.json({ count }, { status: 200 });
    }

    const body = await cachedCountUniquePlayers(query, key);
    return new Response(body, {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
      },
    });
  },
);
