import postgres from 'postgres';

import { sql } from './db';
import { InvalidQueryError } from './errors';

export type CompareOp = '>' | '<' | '>=' | '<=' | '==' | '!=';
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
    default:
      throw new InvalidQueryError(`Invalid operator: ${op}`);
  }
}

export type InComparator<T> = ['in', T[]];
export type RangeComparator<T> = ['range', [T, T]];

/**
 * Represents a comparison of the form "operator field", e.g. ">40"
 */
export type Comparator<T> =
  | [Operator, T]
  | InComparator<T>
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
};

export function join(joins: Join[]) {
  return joins.length > 0
    ? joins.map((j) => sql`JOIN ${j.table} ON ${j.on}`)
    : sql``;
}

type BaseOperand = number | string;
type Operand = BaseOperand | Condition;
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
): [BaseOperand, number] | null {
  if (expression[index] === '(' || expression[index] === ')') {
    return null;
  }

  if (isDigit(expression[index])) {
    let i = index;
    while (i < expression.length && isDigit(expression[i])) {
      i++;
    }
    return [parseInt(expression.slice(index, i)), i];
  }

  if (isAlpha(expression[index])) {
    let i = index;
    while (
      (i < expression.length && isAlpha(expression[i])) ||
      isDigit(expression[i])
    ) {
      i++;
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

  const [op, newIndex2] = operator;
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

  return [lhs, op, rhs];
}

export function parseQuery(expression: string): Condition | null {
  expression = expression.trim();

  const singleCondition = tryParseSingleCondition(expression);
  if (singleCondition) {
    return singleCondition;
  }

  if (expression[0] === '(' && expression[expression.length - 1] === ')') {
    return parseQuery(expression.slice(1, expression.length - 1));
  }

  let depth = 0;
  let parts = [];
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

  return parts.map((part) =>
    part === '&&' || part === '||' ? part : parseQuery(part),
  ) as Condition;
}
