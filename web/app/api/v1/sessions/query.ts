import { SessionQuery } from '@/actions/challenge';
import { InvalidQueryError } from '@/actions/errors';
import {
  dateComparatorParam,
  expectSingle,
  numericComparatorParam,
} from '@/api/query';
import { NextSearchParams } from '@/utils/url';

function parseCursorParam(
  params: NextSearchParams,
  key: 'before' | 'after',
  expectedCount: number,
): number[] | undefined {
  const value = expectSingle(params, key);
  if (value === undefined) {
    return undefined;
  }

  const parts = value.split(',');
  if (parts.length !== expectedCount) {
    throw new InvalidQueryError(
      `${key}: Expected ${expectedCount} cursor value${
        expectedCount === 1 ? '' : 's'
      }`,
    );
  }

  return parts.map((part) => {
    const parsed = Number.parseInt(part.trim(), 10);
    if (Number.isNaN(parsed)) {
      throw new InvalidQueryError(`${key}: Invalid numeric value ${part}`);
    }
    return parsed;
  });
}

export function parseSessionQueryParams(
  searchParams: URLSearchParams,
): SessionQuery {
  return parseSessionQuery(Object.fromEntries(searchParams));
}

export function parseSessionQuery(params: NextSearchParams): SessionQuery {
  const status = numericComparatorParam(params, 'status');
  const expectedCursorCount = status === undefined ? 2 : 1;
  const before = parseCursorParam(params, 'before', expectedCursorCount);
  const after = parseCursorParam(params, 'after', expectedCursorCount);
  if (before !== undefined && after !== undefined) {
    throw new InvalidQueryError('Cannot specify both before and after');
  }

  return {
    type: numericComparatorParam(params, 'type'),
    mode: expectSingle(params, 'mode')
      ?.split(',')
      .map((m) => parseInt(m))
      .filter((m) => !isNaN(m)),
    scale: numericComparatorParam(params, 'scale'),
    startTime: dateComparatorParam(params, 'startTime'),
    status,
    party: expectSingle(params, 'party')
      ?.split(',')
      .map((p) => p.trim()),
    before,
    after,
  };
}
