import { Aggregation } from '@/actions/challenge';
import { InvalidQueryError } from '@/actions/errors';
import { Comparator, Operator } from '@/actions/query';
import { NextSearchParams } from '@/utils/url';

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
    const value = parseInt(v);
    if (isNaN(value)) {
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
 * Returns true if the given string is a valid aggregation.
 *
 * @param agg The string to check.
 * @returns True if the string is a valid aggregation, false otherwise.
 */
export function isAggregation(agg: string): agg is Aggregation {
  return ['count', 'sum', 'avg', 'min', 'max'].includes(agg);
}
