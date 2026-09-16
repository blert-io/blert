import { ChallengeType } from '@blert/common';
import { NextRequest } from 'next/server';

import { InvalidQueryError } from '@/actions/errors';
import {
  getSetups,
  SetupFilter,
  SetupCursor,
  SetupSort,
  SetupState,
} from '@/actions/setup';
import { withApiRoute } from '@/api/handler';
import {
  enumParam,
  expectSingle,
  INT_MAX,
  INT_MIN,
  integerFromToken,
  integerParam,
  MAX_TIMESTAMP,
} from '@/api/query';
import { requestParams } from '@/utils/url';

function isSetupState(state: string): state is SetupState {
  return (
    state === 'draft' ||
    state === 'published' ||
    state === 'archived' ||
    state === 'unlisted'
  );
}

function isSetupSort(sort: string): sort is SetupSort {
  return sort === 'latest' || sort === 'score' || sort === 'views';
}

function setupCursor(
  key: 'after' | 'before',
  sort: SetupSort,
  value: string,
): SetupCursor {
  const direction = key === 'after' ? 'forward' : 'backward';
  const values = value.split(',');
  const expected = sort === 'latest' ? 2 : 3;
  if (values.length !== expected) {
    throw new InvalidQueryError(`${key}: Expected ${expected} cursor values`);
  }

  switch (sort) {
    case 'score':
      return {
        score: integerFromToken(values[0], INT_MIN, INT_MAX, key),
        createdAt: new Date(integerFromToken(values[1], 0, MAX_TIMESTAMP, key)),
        publicId: values[2],
        direction,
        views: 0,
      };
    case 'views':
      return {
        views: integerFromToken(values[0], 0, INT_MAX, key),
        createdAt: new Date(integerFromToken(values[1], 0, MAX_TIMESTAMP, key)),
        publicId: values[2],
        direction,
        score: 0,
      };
    case 'latest':
      return {
        createdAt: new Date(integerFromToken(values[0], 0, MAX_TIMESTAMP, key)),
        publicId: values[1],
        direction,
        score: 0,
        views: 0,
      };
  }

  const _exhaustive: never = sort;
  return _exhaustive;
}

export const GET = withApiRoute(
  { route: '/api/setups' },
  async (request: NextRequest) => {
    const params = requestParams(request.nextUrl.searchParams);

    const limit = integerParam(params, 'limit', 1, 50) ?? 10;

    const sort = expectSingle(params, 'sort') ?? 'latest';
    if (!isSetupSort(sort)) {
      throw new InvalidQueryError(`sort: Invalid value ${sort}`);
    }

    const after = expectSingle(params, 'after');
    const before = expectSingle(params, 'before');
    if (after !== undefined && before !== undefined) {
      throw new InvalidQueryError('Cannot page with both before and after');
    }

    let cursor: SetupCursor | null = null;
    if (after !== undefined) {
      cursor = setupCursor('after', sort, after);
    } else if (before !== undefined) {
      cursor = setupCursor('before', sort, before);
    }

    const filter: SetupFilter = {
      orderBy: sort,
      challenge: enumParam(ChallengeType, params, 'challenge'),
      scale: integerParam(params, 'scale', 1, 8),
      author: integerParam(params, 'author', 1),
    };

    const state = expectSingle(params, 'state');
    if (state !== undefined) {
      if (!isSetupState(state)) {
        throw new InvalidQueryError(`state: Invalid value ${state}`);
      }
      filter.state = state;
    }

    const search = expectSingle(params, 'search');
    if (search !== undefined && search.trim().length > 0) {
      filter.search = search.trim();
    }

    const result = await getSetups(filter, cursor, limit);

    return Response.json({
      setups: result.setups,
      nextCursor: result.nextCursor,
      prevCursor: result.prevCursor,
      total: result.total,
      remaining: result.remaining,
    });
  },
);
