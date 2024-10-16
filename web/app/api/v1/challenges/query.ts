import { ChallengeMode, SplitType } from '@blert/common';

import { ChallengeQuery, SortQuery, SortableFields } from '@/actions/challenge';
import { Comparator, Operator, parseQuery } from '@/actions/query';
import { parseIntParam } from '@/utils/params';

const COMPARATOR_REGEX = /^(lt|gt|le|ge|eq|ne|>|<|>=|<=|=|==|!=)(\d+)$/;
const SPREAD_REGEX = /^(\d+)?(\.\.)(\d+)?$/;
const VALUE_REGEX = /^[a-zA-Z0-9_]+$/;

function op(value: string): Operator {
  switch (value) {
    case 'lt':
    case '<':
      return '<';
    case 'gt':
    case '>':
      return '>';
    case 'le':
    case '<=':
      return '<=';
    case 'ge':
    case '>=':
      return '>=';
    case 'eq':
    case '=':
    case '==':
      return '==';
    case 'ne':
    case '!=':
      return '!=';
    default:
      throw new Error(`Invalid operator: ${value}`);
  }
}

function comparatorValue<T>(
  value: string,
  constructor: (value: string) => T,
): Comparator<T> {
  const values = value.split(',');
  if (values.length > 1) {
    if (!values.every((v) => VALUE_REGEX.test(v))) {
      throw new Error(`Invalid comparator value: ${value}`);
    }
    return ['in', values.map(constructor)];
  }

  let match = value.match(SPREAD_REGEX);
  if (match !== null) {
    const lhs = match[1];
    const rhs = match[3];

    if (lhs === undefined && rhs === undefined) {
      throw new Error(`Invalid range value: ${value}`);
    } else if (lhs === undefined) {
      return ['<', constructor(rhs)];
    } else if (rhs === undefined) {
      return ['>=', constructor(lhs)];
    }

    return ['range', [constructor(lhs), constructor(rhs)]];
  }

  match = value.match(COMPARATOR_REGEX);
  if (match === null) {
    if (VALUE_REGEX.test(value)) {
      return ['==', constructor(value)];
    }

    throw new Error(`Invalid comparator value: ${value}`);
  }

  return [op(match[1]), constructor(match[2])];
}

function comparatorParam<T>(
  searchParams: URLSearchParams,
  param: string,
  constructor: (value: string) => T,
): Comparator<T> | undefined {
  if (!searchParams.has(param)) {
    return undefined;
  }

  const value = searchParams.get(param)!;
  return comparatorValue(value, constructor);
}

export function dateComparatorParam(
  searchParams: URLSearchParams,
  param: string,
): Comparator<Date> | undefined {
  return comparatorParam(
    searchParams,
    param,
    (value) => new Date(parseInt(value)),
  );
}

function numericComparatorValue(value: string): Comparator<number> {
  return comparatorValue(value, (v) => {
    const value = parseInt(v);
    if (isNaN(value)) {
      throw new Error(`Invalid numeric value: ${v}`);
    }
    return value;
  });
}

export function numericComparatorParam(
  searchParams: URLSearchParams,
  param: string,
): Comparator<number> | undefined {
  return comparatorParam(searchParams, param, (v) => {
    const value = parseInt(v);
    if (isNaN(value)) {
      throw new Error(`Invalid numeric value: ${v}`);
    }
    return value;
  });
}

export function parseChallengeQuery(
  searchParams: URLSearchParams,
): ChallengeQuery | null {
  const party = searchParams.get('party')?.split(',') ?? undefined;

  const query: ChallengeQuery = {
    mode: parseIntParam<ChallengeMode>(searchParams, 'mode'),
    party,
    splits: new Map(),
    customConditions: [],
  };

  const sort = searchParams.get('sort') ?? undefined;
  if (sort !== undefined) {
    query.sort = [];

    const sortFields = sort.split(',');
    for (const sort of sortFields) {
      if (sort[0] !== '-' && sort[0] !== '+') {
        return null;
      }
      query.sort.push(sort as SortQuery<SortableFields>);
    }
  }

  for (const [key, value] of searchParams.entries()) {
    if (key.startsWith('split:')) {
      const parts = key.split(':');
      if (parts.length !== 2) {
        return null;
      }

      const split = parseInt(parts[1]) as SplitType;
      if (Number.isNaN(split)) {
        return null;
      }

      try {
        query.splits!.set(split, numericComparatorValue(value));
      } catch (e) {
        return null;
      }
    }
  }

  try {
    query.type = numericComparatorParam(searchParams, 'type');
    query.scale = numericComparatorParam(searchParams, 'scale');
    query.status = numericComparatorParam(searchParams, 'status');
    query.startTime = dateComparatorParam(searchParams, 'startTime');
    query.challengeTicks = numericComparatorParam(
      searchParams,
      'challengeTicks',
    );
  } catch (e) {
    return null;
  }

  const customQuery = searchParams.get('q');
  if (customQuery !== null) {
    const customConditions = parseQuery(atob(customQuery));
    if (customConditions === null) {
      return null;
    }
    query.customConditions!.push(customConditions);
  }

  return query;
}
