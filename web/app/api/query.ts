import { AggregationQuery } from '@/actions/challenge';
import { InvalidQueryError } from '@/actions/errors';
import {
  Aggregation,
  aggregationKey,
  Comparator,
  Operator,
  parseAggregation,
  parseSort,
} from '@/actions/query';
import { NextSearchParams } from '@/utils/url';

/**
 * Parses an aggregation token from a request, accepting convenience aliases.
 * @returns The parsed aggregation, or `null` if the token is invalid.
 */
export function parseAggregationParam(token: string): Aggregation | null {
  return parseAggregation(token === 'median' ? 'p50' : token);
}

/**
 * Normalizes the aggregation token in a sort string to its canonical key,
 * applying the same aliases as {@link parseAggregationParam}.
 * Non-aggregation sort fields are left untouched.
 */
export function normalizeSortAggregation(sort: string): string {
  const { direction, field, options } = parseSort(sort);

  const colon = field.lastIndexOf(':');
  const prefix = colon === -1 ? '' : field.slice(0, colon + 1);
  const token = colon === -1 ? field : field.slice(colon + 1);

  const parsed = parseAggregationParam(token);
  const normalized = parsed === null ? token : aggregationKey(parsed);
  const suffix = options === undefined ? '' : `#${options}`;
  return `${direction}${prefix}${normalized}${suffix}`;
}

type RequestedKeyAliases = Record<string, Record<string, string>>;

/**
 * Parses aggregation query URL parameters into an aggregation query and an
 * alias mapping back to the requested tokens.
 *
 * @param params Raw URL parameters.
 * @returns Parsed aggregations and aliases, or `null` if any param is invalid.
 */
export function parseAggregateParams(
  params: string[],
): { aggregations: AggregationQuery; aliases: RequestedKeyAliases } | null {
  const aggregations: AggregationQuery = { '*': { type: 'count' } };
  const aliases: RequestedKeyAliases = {};

  for (const param of params) {
    const separator = param.lastIndexOf(':');
    const field = param.slice(0, separator);
    const tokens = param.slice(separator + 1).split(',');
    const parsed = tokens.map(parseAggregationParam);
    if (parsed.length === 0 || parsed.some((agg) => agg === null)) {
      return null;
    }

    const aggs = parsed as Aggregation[];
    aggregations[field] = aggs;
    tokens.forEach((token, i) => {
      const key = aggregationKey(aggs[i]);
      if (key !== token) {
        (aliases[field] ??= {})[key] = token;
      }
    });
  }

  return { aggregations, aliases };
}

/**
 * Replaces canonical aggregation keys with user-requested aliases in place.
 *
 * @param result Aggregation result returned by the query.
 * @param depth Number of grouping levels in the result.
 * @param aliases User's field alias mapping.
 */
export function restoreAggregateAliases(
  result: Record<string, unknown>,
  depth: number,
  aliases: RequestedKeyAliases,
): void {
  if (Object.keys(aliases).length === 0) {
    return;
  }

  if (depth > 0) {
    for (const group of Object.values(result)) {
      restoreAggregateAliases(
        group as Record<string, unknown>,
        depth - 1,
        aliases,
      );
    }
    return;
  }

  for (const [field, renames] of Object.entries(aliases)) {
    const aggs = result[field] as Record<string, number> | undefined;
    if (aggs === undefined) {
      continue;
    }
    for (const [key, token] of Object.entries(renames)) {
      if (key in aggs) {
        aggs[token] = aggs[key];
        delete aggs[key];
      }
    }
  }
}

const COMPARATOR_REGEX = /^(lt|gt|le|ge|eq|ne|>=|<=|==|!=|=|>|<)(\d+)$/;
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

  let match = SPREAD_REGEX.exec(value);
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

  match = COMPARATOR_REGEX.exec(value);
  if (match === null) {
    if (VALUE_REGEX.test(value)) {
      return ['==', constructor(value)];
    }

    throw new Error(`Invalid comparator value: ${value}`);
  }

  return [op(match[1]), constructor(match[2])];
}

function comparatorParam<T>(
  searchParams: NextSearchParams,
  param: string,
  constructor: (value: string) => T,
): Comparator<T> | undefined {
  const value = searchParams[param];
  if (value === undefined || Array.isArray(value)) {
    return undefined;
  }

  return comparatorValue(value, constructor);
}

/**
 * Returns a comparator for a date search parameter.
 *
 * @param searchParams The search params object.
 * @param param The parameter key.
 * @returns The comparator for the parameter.
 * @throws InvalidQueryError If the parameter's value is not a date.
 */
export function dateComparatorParam(
  searchParams: NextSearchParams,
  param: string,
): Comparator<Date> | undefined {
  return comparatorParam(
    searchParams,
    param,
    (value) => new Date(parseInt(value)),
  );
}

/**
 * Returns a comparator for a numeric value.
 *
 * @param value The value to convert to a comparator.
 * @returns The comparator for the value.
 * @throws InvalidQueryError If the value is not a number.
 */
export function numericComparatorValue(value: string): Comparator<number> {
  return comparatorValue(value, (v) => {
    const value = parseInt(v);
    if (isNaN(value)) {
      throw new InvalidQueryError(`Invalid numeric value ${v}`);
    }
    return value;
  });
}

/**
 * Returns a comparator for a numeric search parameter.
 *
 * @param searchParams The search params object.
 * @param param The parameter key.
 * @returns The comparator for the parameter.
 * @throws InvalidQueryError If the parameter's value is not a number.
 */
export function numericComparatorParam(
  searchParams: NextSearchParams,
  param: string,
): Comparator<number> | undefined {
  return comparatorParam(searchParams, param, (v) => {
    const value = Number(v);
    if (!Number.isFinite(value)) {
      throw new InvalidQueryError(`${param}: Invalid numeric value ${v}`);
    }
    return value;
  });
}

/**
 * Returns the value of a single occurrence of a search param.
 * If multiple occurrences are found, throws an error.
 *
 * @param obj The search params object.
 * @param key The key to expect a single value for.
 * @returns The value for the key.
 * @throws InvalidQueryError If param `key` appears multiple times.
 */
export function expectSingle(
  obj: NextSearchParams,
  key: string,
): string | undefined {
  const value = obj[key];
  if (value === undefined) {
    return undefined;
  }

  if (Array.isArray(value)) {
    if (value.length !== 1) {
      throw new InvalidQueryError(`Expected single value for key: ${key}`);
    }
    return value[0];
  }

  return value;
}

/**
 * Parses a comma-separated list of numbers from a search parameter.
 *
 * @param obj The search params object.
 * @param key The parameter key.
 * @returns The list of numbers, or `undefined` if the parameter is not present.
 */
export function numericListParam<T extends number = number>(
  obj: NextSearchParams,
  key: string,
): T[] | undefined {
  return expectSingle(obj, key)
    ?.split(',')
    .map((v) => parseInt(v) as T)
    ?.filter((v) => !isNaN(v));
}

/**
 * Parses a numeric value from a search parameter.
 *
 * @param obj The search params object.
 * @param key The parameter key.
 * @returns The numeric value, or `undefined` if the parameter is not present.
 */
export function numericParam<T extends number = number>(
  obj: NextSearchParams,
  key: string,
): T | undefined {
  const value = expectSingle(obj, key);
  if (value === undefined) {
    return undefined;
  }

  const num = parseInt(value);
  if (isNaN(num)) {
    throw new InvalidQueryError(`${key}: Invalid numeric value ${value}`);
  }

  return num as T;
}
