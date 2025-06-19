import { SessionQuery } from '@/actions/challenge';
import {
  dateComparatorParam,
  expectSingle,
  numericComparatorParam,
} from '@/api/query';
import { NextSearchParams } from '@/utils/url';

export function parseSessionQueryParams(
  searchParams: URLSearchParams,
): SessionQuery {
  return parseSessionQuery(Object.fromEntries(searchParams));
}

export function parseSessionQuery(params: NextSearchParams): SessionQuery {
  return {
    type: numericComparatorParam(params, 'type'),
    mode: expectSingle(params, 'mode')
      ?.split(',')
      .map((m) => parseInt(m))
      .filter((m) => !isNaN(m)),
    scale: numericComparatorParam(params, 'scale'),
    startTime: dateComparatorParam(params, 'startTime'),
    status: numericComparatorParam(params, 'status'),
  };
}
