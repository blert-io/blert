import postgres from 'postgres';

import { sql } from './db';
import { InvalidQueryError } from './errors';

export type Operator =
  | '>'
  | '<'
  | '>='
  | '<='
  | '='
  | '=='
  | '!='
  | 'lt'
  | 'gt'
  | 'lte'
  | 'gte'
  | 'eq'
  | 'ne';

/**
 * Returns the SQL operator for the given operator string.
 * @param op Operator string.
 * @returns SQL operator wrapped in a fragment, ready for direct use.
 */
export function operator(op: Operator): postgres.Fragment {
  switch (op) {
    case 'lt':
    case '<':
      return sql`<`;
    case 'gt':
    case '>':
      return sql`>`;
    case 'lte':
    case '<=':
      return sql`<=`;
    case 'gte':
    case '>=':
      return sql`>=`;
    case 'eq':
    case '=':
    case '==':
      return sql`=`;
    case 'ne':
    case '!=':
      return sql`!=`;
    default:
      throw new InvalidQueryError(`Invalid operator: ${op}`);
  }
}

/**
 * Represents a comparison of the form "field operator value".
 */
export type Comparator<T, V> = [T, Operator, V];

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
  table: postgres.Fragment;
  on: postgres.Fragment;
};

export function join(joins: Join[]) {
  return joins.length > 0
    ? joins.map((j) => sql`JOIN ${j.table} ON ${j.on}`)
    : sql``;
}
