import postgres from 'postgres';

import { sql } from './db';
import { InvalidQueryError } from './errors';

export type CompareOp = '>' | '<' | '>=' | '<=' | '==' | '!=' | 'is' | 'isnot';
export type Operator = CompareOp | '&&' | '||';

/**
 * Returns the SQL operator for the given operator string.
 * @param op Operator string.
 * @returns SQL operator wrapped in a fragment, ready for direct use.
 */
export function operator(op: Operator): postgres.Fragment {
  switch (op) {
    case '<':
      return sql`<`;
    case '>':
      return sql`>`;
    case '<=':
      return sql`<=`;
    case '>=':
      return sql`>=`;
    case '==':
      return sql`=`;
    case '!=':
      return sql`!=`;
    case '&&':
      return sql`AND`;
    case '||':
      return sql`OR`;
    case 'is':
      return sql`IS`;
    case 'isnot':
      return sql`IS NOT`;
    default:
      throw new InvalidQueryError(`Invalid operator: ${op as string}`);
  }
}

export type InComparator<T> = ['in', T[]];
export type NinComparator<T> = ['nin', T[]];
export type RangeComparator<T> = ['range', [T, T]];

/**
 * Represents a comparison of the form "operator field", e.g. ">40"
 */
export type Comparator<T> =
  | [Operator, T]
  | InComparator<T>
  | NinComparator<T>
  | RangeComparator<T>;

export function where(
  conditions: postgres.Fragment[],
  cond: 'and' | 'or' = 'and',
): postgres.Fragment {
  const separator = cond === 'and' ? sql`AND` : sql`OR`;
  return conditions.length > 0
    ? sql`WHERE (${conditions.flatMap((c, i) => (i > 0 ? [separator, c] : c))})`
    : sql``;
}

export type Join = {
  table: postgres.Fragment | postgres.Helper<string>;
  on: postgres.Fragment;
  tableName: string;
  type?: 'inner' | 'left' | 'right';
};

export function join(joins: Join[]) {
  const unique = new Map<string, Join>();
  joins.forEach((j) => unique.set(j.tableName, j));
  const result = Array.from(unique.values());

  return result.length > 0
    ? result.map((j) => {
        let type;
        if (j.type === 'left') {
          type = sql`LEFT`;
        } else if (j.type === 'right') {
          type = sql`RIGHT`;
        } else {
          type = sql`INNER`;
        }
        return sql`${type} JOIN ${j.table} ON ${j.on}`;
      })
    : sql``;
}

export type ComparableValue = number | string | Date;

export function comparatorToSql(
  table: postgres.Helper<string>,
  column: string,
  comparator: Comparator<ComparableValue>,
): postgres.Fragment;

export function comparatorToSql(
  expression: postgres.Fragment,
  comparator: Comparator<ComparableValue>,
): postgres.Fragment;

export function comparatorToSql(
  ...args:
    | [postgres.Helper<string>, string, Comparator<ComparableValue>]
    | [postgres.Fragment, Comparator<ComparableValue>]
): postgres.Fragment {
  let lhs: postgres.Fragment;
  let comparator: Comparator<ComparableValue>;

  if (args.length === 3) {
    const [table, column] = args;
    lhs = sql`${table}.${sql(column)}`;
    comparator = args[2];
  } else {
    [lhs, comparator] = args;
  }

  if (comparator[0] === 'in') {
    return sql`${lhs} = ANY(${comparator[1]})`;
  }

  if (comparator[0] === 'nin') {
    return sql`${lhs} <> ALL(${comparator[1]})`;
  }

  if (comparator[0] === 'range') {
    const [start, end] = comparator[1];
    return sql`${lhs} >= ${start} AND ${lhs} < ${end}`;
  }

  const op = operator(comparator[0]);
  return sql`${lhs} ${op} ${comparator[1]}`;
}

/**
 * Like {@link comparatorToSql}, but for an array column, interpreting the
 * comparator as set membership.
 */
export function arrayComparatorToSql(
  table: postgres.Helper<string>,
  column: string,
  comparator: Comparator<ComparableValue>,
): postgres.Fragment;

export function arrayComparatorToSql(
  expression: postgres.Fragment,
  comparator: Comparator<ComparableValue>,
): postgres.Fragment;

export function arrayComparatorToSql(
  ...args:
    | [postgres.Helper<string>, string, Comparator<ComparableValue>]
    | [postgres.Fragment, Comparator<ComparableValue>]
): postgres.Fragment {
  let lhs: postgres.Fragment;
  let comparator: Comparator<ComparableValue>;

  if (args.length === 3) {
    const [table, column] = args;
    lhs = sql`${table}.${sql(column)}`;
    comparator = args[2];
  } else {
    [lhs, comparator] = args;
  }

  let values: ComparableValue[];
  let negated: boolean;
  switch (comparator[0]) {
    case '==':
    case '!=':
      values = [comparator[1]];
      negated = comparator[0] === '!=';
      break;
    case 'in':
    case 'nin':
      values = comparator[1];
      negated = comparator[0] === 'nin';
      break;
    default:
      throw new InvalidQueryError(
        `Unsupported array operator: ${comparator[0]}`,
      );
  }

  const overlap = sql`${lhs} && ${values}`;
  return negated ? sql`NOT (${overlap})` : overlap;
}

/**
 * A `SortQuery` is a string that represents a field to sort by. It consists of
 * three parts:
 * - A prefix that indicates the sort order: `+` for ascending, `-` for
 *   descending.
 * - The name of the field to sort by.
 * - Optionally, a suffix specifying additional sorting options. This can be
 *   one of the following:
 *   * `#nf` to indicate that null values should be sorted first.
 *   * `#nl` to indicate that null values should be sorted last.
 */
export type SortQuery<T> = `${SortDirection}${T extends object
  ? keyof T & string
  : T extends string
    ? T
    : never}${`#${SortOptions}` | ''}`;

export type SortDirection = '+' | '-';
export type SortOptions = 'nf' | 'nl';

function isSortDirection(s: string): s is SortDirection {
  return s === '+' || s === '-';
}

function isSortOptions(s: string): s is SortOptions {
  return s === 'nf' || s === 'nl';
}

/**
 * Parses a sort string of the form `[+-]field[#nf|#nl]` into its parts.
 *
 * @throws InvalidQueryError if the direction or options are invalid.
 */
export function parseSort(sort: string): {
  direction: SortDirection;
  field: string;
  options: SortOptions | undefined;
} {
  const direction = sort[0];
  if (!isSortDirection(direction)) {
    throw new InvalidQueryError(`Invalid sort direction: ${direction}`);
  }

  const [field, options] = sort.slice(1).split('#');
  if (options !== undefined && !isSortOptions(options)) {
    throw new InvalidQueryError(`Invalid sort options: ${options}`);
  }

  return { direction, field, options };
}

/**
 * An aggregation operation.
 *
 * `percentile` carries the requested percentile in `[0, 100]` and is computed
 * using `PERCENTILE_CONT`.
 */
export type Aggregation =
  | { type: 'count' }
  | { type: 'sum' }
  | { type: 'avg' }
  | { type: 'min' }
  | { type: 'max' }
  | { type: 'percentile'; value: number };

/**
 * The string key an aggregation produces in result objects and SQL aliases.
 * Percentiles serialize to `pN` (e.g. `p50`); every other variant uses its
 * `type`.
 */
export type AggregationKey<A extends Aggregation = Aggregation> = A extends {
  type: 'percentile';
  value: infer V;
}
  ? V extends number
    ? `p${V}`
    : never
  : A extends { type: infer T }
    ? T & string
    : never;

const PERCENTILE_PATTERN = /^p(\d+(?:\.\d+)?)$/;

/**
 * Parses a raw aggregation string into an {@link Aggregation}.
 *
 * @returns The parsed aggregation, or `null` if the input is invalid.
 */
export function parseAggregation(raw: string): Aggregation | null {
  switch (raw) {
    case 'count':
    case 'sum':
    case 'avg':
    case 'min':
    case 'max':
      return { type: raw };
  }

  const match = PERCENTILE_PATTERN.exec(raw);
  if (match === null) {
    return null;
  }
  const value = parseFloat(match[1]);
  if (value < 0 || value > 100) {
    return null;
  }
  return { type: 'percentile', value };
}

/**
 * Returns the string key for an aggregation.
 */
export function aggregationKey(agg: Aggregation): AggregationKey {
  return agg.type === 'percentile' ? `p${agg.value}` : agg.type;
}

/**
 * Returns the SQL fragment for an aggregation function applied to `column`.
 */
export function aggregationToSql(
  agg: Aggregation,
  column: postgres.Fragment,
): postgres.Fragment {
  switch (agg.type) {
    case 'count':
      return sql`COUNT(${column})`;
    case 'sum':
      return sql`SUM(${column})`;
    case 'avg':
      return sql`AVG(${column})`;
    case 'min':
      return sql`MIN(${column})`;
    case 'max':
      return sql`MAX(${column})`;
    case 'percentile':
      if (agg.value < 0 || agg.value > 100) {
        throw new InvalidQueryError(`Invalid percentile: ${agg.value}`);
      }
      return sql`PERCENTILE_CONT(${
        agg.value / 100
      }::float8) WITHIN GROUP (ORDER BY ${column})`;
    default: {
      const _exhaustive: never = agg;
      throw new InvalidQueryError(
        `Unknown aggregation: ${JSON.stringify(_exhaustive)}`,
      );
    }
  }
}

/**
 * Throws {@link InvalidQueryError} if any aggregation is semantically invalid.
 */
export function assertValidAggregations(aggregations: Aggregation[]): void {
  // Currently, the only runtime invalid case is a bad percentile value.
  const invalid = aggregations.filter(
    (agg): agg is { type: 'percentile'; value: number } =>
      agg.type === 'percentile' && (agg.value < 0 || agg.value > 100),
  );
  if (invalid.length > 0) {
    throw new InvalidQueryError(
      `Invalid percentile(s): ${invalid.map((agg) => agg.value).join(', ')}`,
    );
  }
}

/**
 * Maps a SQL column alias back to its original field and aggregation key
 * from which it was produced.
 */
export type AggregateAliases = Record<
  string,
  { field: string; aggKey: AggregationKey }
>;

/** Returns the column alias for an aggregation. */
export function aggregateAlias(aggKey: AggregationKey, suffix: string): string {
  // A percentile key (`pN`) may contain '.', which postgres reads as an
  // identifier separator, so it is sanitized.
  return `${aggKey.replace(/\./g, '_')}_${suffix}`;
}

/**
 * Builds `<aggregation> AS <alias>` SELECT fragments for `aggregations` over
 * `column`, recording each alias.
 */
export function aggregateSelectColumns(
  field: string,
  suffix: string,
  column: postgres.Fragment,
  aggregations: Aggregation[],
  filter?: postgres.Fragment,
): [postgres.Fragment[], AggregateAliases] {
  const aliases: AggregateAliases = {};
  const fragments = [];

  for (const agg of aggregations) {
    const aggKey = aggregationKey(agg);
    const alias = aggregateAlias(aggKey, suffix);
    aliases[alias] = { field, aggKey };
    const aggregate = aggregationToSql(agg, column);
    const filtered =
      filter === undefined
        ? aggregate
        : sql`${aggregate} FILTER (WHERE ${filter})`;
    fragments.push(sql`${filtered} AS ${sql(alias)}`);
  }

  return [fragments, aliases];
}

function floatOrZero(value: unknown): number {
  const num = parseFloat(value as string);
  return Number.isNaN(num) ? 0 : num;
}

/**
 * Unpacks one query result row into an aggregation result of per-field
 * aggregations using an alias mapping.
 */
export function rowToAggregations(
  row: Record<string, unknown>,
  aliases: AggregateAliases,
): Record<string, Record<string, number>> {
  const result: Record<string, Record<string, number>> = {};
  for (const [column, value] of Object.entries(row)) {
    if (column === 'count') {
      result['*'] = { count: parseInt(value as string) };
      continue;
    }
    const alias = aliases[column];
    if (alias === undefined) {
      continue;
    }
    (result[alias.field] ??= {})[alias.aggKey] = floatOrZero(value as string);
  }
  return result;
}

export type BaseOperand = number | string | null;
export type Operand = BaseOperand | Condition;
export type Condition = [Operand, Operator, Operand];

function consumeWhitespace(expression: string, index: number): number {
  while (index < expression.length && expression[index] === ' ') {
    index++;
  }
  return index;
}

function isDigit(char: string): boolean {
  return char.charCodeAt(0) >= 48 && char.charCodeAt(0) <= 57;
}

function isAlpha(char: string): boolean {
  return (
    (char.charCodeAt(0) >= 65 && char.charCodeAt(0) <= 90) ||
    (char.charCodeAt(0) >= 97 && char.charCodeAt(0) <= 122)
  );
}

function tryParseOperand(
  expression: string,
  index: number,
): [string | number, number] | null {
  if (expression[index] === '(' || expression[index] === ')') {
    return null;
  }

  // Try to parse a number.
  if (isDigit(expression[index])) {
    let i = index;
    while (i < expression.length && isDigit(expression[i])) {
      i++;
    }
    return [parseInt(expression.slice(index, i)), i];
  }

  // Try to parse an identifier with an optional numeric suffix following a ':'.
  if (isAlpha(expression[index])) {
    let i = index;
    while (
      i < expression.length &&
      (isAlpha(expression[i]) || isDigit(expression[i]))
    ) {
      i++;
    }
    if (expression[i] === ':') {
      i++;
      if (i === expression.length || !isDigit(expression[i])) {
        return null;
      }
      while (i < expression.length && isDigit(expression[i])) {
        i++;
      }
    }
    return [expression.slice(index, i), i];
  }

  return null;
}

function tryParseOperator(
  expression: string,
  index: number,
): [Operator, number] | null {
  if (expression[index] === '&' && expression[index + 1] === '&') {
    return ['&&', index + 2];
  }
  if (expression[index] === '|' && expression[index + 1] === '|') {
    return ['||', index + 2];
  }
  if (expression[index] === '>' && expression[index + 1] === '=') {
    return ['>=', index + 2];
  }
  if (expression[index] === '<' && expression[index + 1] === '=') {
    return ['<=', index + 2];
  }
  if (expression[index] === '=' && expression[index + 1] === '=') {
    return ['==', index + 2];
  }
  if (expression[index] === '!' && expression[index + 1] === '=') {
    return ['!=', index + 2];
  }
  if (expression[index] === '<') {
    return ['<', index + 1];
  }
  if (expression[index] === '>') {
    return ['>', index + 1];
  }
  return null;
}

function convertNull(operand: string | number): string | number | null {
  return operand === 'null' ? null : operand;
}

function tryParseSingleCondition(
  expression: string,
): [BaseOperand, Operator, BaseOperand] | null {
  let index = consumeWhitespace(expression, 0);

  const op1 = tryParseOperand(expression, index);
  if (op1 === null) {
    return null;
  }

  const [lhs, newIndex] = op1;
  index = consumeWhitespace(expression, newIndex);

  const operator = tryParseOperator(expression, index);
  if (operator === null) {
    return null;
  }

  const [initialOp, newIndex2] = operator;
  let op = initialOp;
  index = consumeWhitespace(expression, newIndex2);

  const op2 = tryParseOperand(expression, index);
  if (op2 === null) {
    return null;
  }

  const [rhs, newIndex3] = op2;
  index = consumeWhitespace(expression, newIndex3);

  if (index !== expression.length) {
    return null;
  }

  if (lhs === 'null' || rhs === 'null') {
    // Only allow equality and inequality checks with null.
    switch (op) {
      case '==':
        op = 'is';
        break;
      case '!=':
        op = 'isnot';
        break;
      default:
        return null;
    }
  }

  return [convertNull(lhs), op, convertNull(rhs)];
}

export function parseQuery(expression: string): Condition | null {
  expression = expression.trim();

  const singleCondition = tryParseSingleCondition(expression);
  if (singleCondition) {
    return singleCondition;
  }

  let depth = 0;
  const parts: string[] = [];
  let lastIndex = 0;

  for (let i = 0; i < expression.length; i++) {
    if (expression[i] === '(') {
      depth++;
    }
    if (expression[i] === ')') {
      depth--;
    }

    if (
      depth === 0 &&
      (expression.slice(i, i + 2) === '&&' ||
        expression.slice(i, i + 2) === '||')
    ) {
      parts.push(expression.slice(lastIndex, i).trim());
      parts.push(expression.slice(i, i + 2).trim());
      lastIndex = i + 2;
    }
  }
  parts.push(expression.slice(lastIndex).trim());

  if (
    parts.length === 1 &&
    parts[0].startsWith('(') &&
    parts[0].endsWith(')')
  ) {
    return parseQuery(parts[0].slice(1, -1));
  }

  return parts.map((part) =>
    part === '&&' || part === '||' ? part : parseQuery(part),
  ) as Condition;
}
