import {
  ChallengeType,
  Coords,
  Stage,
  challengeName,
  isColosseumStage,
  isInfernoStage,
} from '@blert/common';

import { AggregationQuery, SpawnQuery } from '@/actions/challenge';
import { InvalidQueryError } from '@/actions/errors';
import {
  Aggregation,
  aggregationKey,
  Comparator,
  Operator,
  parseAggregation,
  parseSort,
} from '@/actions/query';
import { encodePlayerTile, encodeSpawn, encodeTile } from '@/utils/spawn-index';
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
      throw new InvalidQueryError(`Invalid operator: ${value}`);
  }
}

function comparatorValue<T>(
  value: string,
  constructor: (value: string) => T,
): Comparator<T> {
  // A leading '!', '!=', or 'ne' negates the value or list of values.
  let negatedRest: string | undefined;
  if (value.startsWith('!=') || value.startsWith('ne')) {
    negatedRest = value.slice(2);
  } else if (value.startsWith('!')) {
    negatedRest = value.slice(1);
  }
  if (negatedRest !== undefined) {
    const negated = negatedRest.split(',');
    if (!negated.every((v) => VALUE_REGEX.test(v))) {
      throw new InvalidQueryError(`Invalid comparator value: ${value}`);
    }
    return negated.length > 1
      ? ['nin', negated.map(constructor)]
      : ['!=', constructor(negated[0])];
  }

  const values = value.split(',');
  if (values.length > 1) {
    if (!values.every((v) => VALUE_REGEX.test(v))) {
      throw new InvalidQueryError(`Invalid comparator value: ${value}`);
    }
    return ['in', values.map(constructor)];
  }

  let match = SPREAD_REGEX.exec(value);
  if (match !== null) {
    const lhs = match[1];
    const rhs = match[3];

    if (lhs === undefined && rhs === undefined) {
      throw new InvalidQueryError(`Invalid range value: ${value}`);
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

    throw new InvalidQueryError(`Invalid comparator value: ${value}`);
  }

  return [op(match[1]), constructor(match[2])];
}

export function comparatorParam<T>(
  searchParams: NextSearchParams,
  param: string,
  constructor: (value: string) => T,
): Comparator<T> | undefined {
  let value = searchParams[param];
  if (value === undefined) {
    return undefined;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return undefined;
    }
    value = value.at(-1)!;
  }

  return comparatorValue(value, constructor);
}

/** The largest millisecond timestamp a `Date` can represent. */
export const MAX_TIMESTAMP = 8.64e15;

/**
 * Returns a comparator for a date search parameter, given as a millisecond
 * timestamp.
 *
 * @param searchParams The search params object.
 * @param param The parameter key.
 * @returns The comparator for the parameter.
 * @throws InvalidQueryError If the parameter's value is not a timestamp.
 */
export function dateComparatorParam(
  searchParams: NextSearchParams,
  param: string,
): Comparator<Date> | undefined {
  return comparatorParam(
    searchParams,
    param,
    (value) => new Date(integerFromToken(value, 0, MAX_TIMESTAMP, param)),
  );
}

export const INT_MIN = -(2 ** 31);
export const INT_MAX = 2 ** 31 - 1;
export const SMALLINT_MIN = -(2 ** 15);
export const SMALLINT_MAX = 2 ** 15 - 1;

/**
 * Parses an integer from a single token.
 *
 * @param token The token to parse.
 * @param min The smallest accepted value.
 * @param max The largest accepted value.
 * @param name A name with which to prefix query errors.
 * @returns The parsed integer.
 * @throws InvalidQueryError If the token is not an integer in the range.
 */
export function integerFromToken(
  token: string,
  min: number,
  max: number,
  name?: string,
): number {
  const err = (str: string) =>
    new InvalidQueryError(name !== undefined ? `${name}: ${str}` : str);

  if (!/^-?\d+$/.test(token)) {
    throw err(`Invalid numeric value ${token}`);
  }
  const value = Number(token);
  if (value < min || value > max) {
    throw err(`Value ${value} is out of range [${min}, ${max}]`);
  }
  return value;
}

/**
 * Returns a comparator for a numeric value.
 *
 * @param value The value to convert to a comparator.
 * @param min The smallest accepted value.
 * @param max The largest accepted value.
 * @param name A name with which to prefix query errors.
 * @returns The comparator for the value.
 * @throws InvalidQueryError If the value is not an integer in the range.
 */
export function integerComparatorValue(
  value: string,
  min: number = INT_MIN,
  max: number = INT_MAX,
  name?: string,
): Comparator<number> {
  return comparatorValue(value, (v) => integerFromToken(v, min, max, name));
}

/**
 * Returns a comparator for a numeric search parameter.
 *
 * @param searchParams The search params object.
 * @param param The parameter key.
 * @param min The smallest accepted value.
 * @param max The largest accepted value.
 * @returns The comparator for the parameter.
 * @throws InvalidQueryError If the parameter's value is not an integer in the
 *   range.
 */
export function integerComparatorParam(
  searchParams: NextSearchParams,
  param: string,
  min: number = INT_MIN,
  max: number = INT_MAX,
): Comparator<number> | undefined {
  return comparatorParam(searchParams, param, (v) =>
    integerFromToken(v, min, max, param),
  );
}

/** A numeric enum, whose object holds its members and their reverse mapping. */
type NumericEnum<T extends number> = Record<string, T | string>;

export function isValidEnumValue<T extends number>(
  enumObject: NumericEnum<T>,
  value: number,
): value is T {
  return Object.values(enumObject).some((member) => member === value);
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Checks that every given value is a UUID.
 *
 * @param value The value or values to check.
 * @param name A name with which to prefix query errors.
 * @throws InvalidQueryError If any value is invalid.
 */
export function assertValidUuid(value: string | string[], name?: string): void {
  const values = Array.isArray(value) ? value : [value];
  const invalid = values.filter((uuid) => !UUID_REGEX.test(uuid));
  if (invalid.length > 0) {
    const bad = invalid.join(',');
    throw new InvalidQueryError(
      name === undefined
        ? `Invalid uuid ${bad}`
        : `${name}: Invalid uuid ${bad}`,
    );
  }
}

/**
 * Returns a comparator for a value which is a member of a numeric enum.
 *
 * @param enumObject The enum whose members are accepted.
 * @param value The value to convert to a comparator.
 * @param name A name with which to prefix query errors.
 * @returns The comparator for the value.
 * @throws InvalidQueryError If the value is not a member of the enum.
 */
export function enumComparatorValue<T extends number>(
  enumObject: NumericEnum<T>,
  value: string,
  name?: string,
): Comparator<T> {
  return comparatorValue(value, (v) => {
    const member = integerFromToken(v, 0, INT_MAX, name);
    if (!isValidEnumValue(enumObject, member)) {
      throw new InvalidQueryError(
        name === undefined
          ? `Invalid value ${v}`
          : `${name}: Invalid value ${v}`,
      );
    }
    return member;
  });
}

/**
 * Returns a comparator for a search parameter which is a member of a numeric
 * enum.
 *
 * @param enumObject The enum whose members are accepted.
 * @param searchParams The search params object.
 * @param param The parameter key.
 * @returns The comparator for the parameter.
 * @throws InvalidQueryError If the parameter's value is not a member of the
 *   enum.
 */
export function enumComparatorParam<T extends number>(
  enumObject: NumericEnum<T>,
  searchParams: NextSearchParams,
  param: string,
): Comparator<T> | undefined {
  return comparatorParam(searchParams, param, (v) => {
    const member = integerFromToken(v, 0, INT_MAX, param);
    if (!isValidEnumValue(enumObject, member)) {
      throw new InvalidQueryError(`${param}: Invalid value ${v}`);
    }
    return member;
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
 * Parses a comma-separated list of integers from a search parameter.
 *
 * @param obj The search params object.
 * @param key The parameter key.
 * @param min The smallest accepted value.
 * @param max The largest accepted value.
 * @returns The list of integers, or `undefined` if the parameter is not
 *   present.
 * @throws InvalidQueryError If a value is not an integer in the range.
 */
export function integerListParam<T extends number = number>(
  obj: NextSearchParams,
  key: string,
  min: number = INT_MIN,
  max: number = INT_MAX,
): T[] | undefined {
  return expectSingle(obj, key)
    ?.split(',')
    .map((v) => integerFromToken(v, min, max, key) as T);
}

/**
 * Parses an integer from a search parameter.
 *
 * @param obj The search params object.
 * @param key The parameter key.
 * @param min The smallest accepted value.
 * @param max The largest accepted value.
 * @returns The integer, or `undefined` if the parameter is not present.
 * @throws InvalidQueryError If the value is not an integer in the range.
 */
export function integerParam<T extends number = number>(
  obj: NextSearchParams,
  key: string,
  min: number = INT_MIN,
  max: number = INT_MAX,
): T | undefined {
  const value = expectSingle(obj, key);
  return value === undefined
    ? undefined
    : (integerFromToken(value, min, max, key) as T);
}

/**
 * Parses a member of a numeric enum from a search parameter.
 *
 * @param enumObject The enum whose members are accepted.
 * @param obj The search params object.
 * @param key The parameter key.
 * @returns The member, or `undefined` if the parameter is not present.
 * @throws InvalidQueryError If the value is not a member of the enum.
 */
export function enumParam<T extends number>(
  enumObject: NumericEnum<T>,
  obj: NextSearchParams,
  key: string,
): T | undefined {
  const value = integerParam(obj, key, 0, INT_MAX);
  if (value !== undefined && !isValidEnumValue(enumObject, value)) {
    throw new InvalidQueryError(`${key}: Invalid value ${value}`);
  }
  return value;
}

/**
 * Parses a comma-separated list of members of a numeric enum from a search
 * parameter.
 *
 * @param enumObject The enum whose members are accepted.
 * @param obj The search params object.
 * @param key The parameter key.
 * @returns The members, or `undefined` if the parameter is not present.
 * @throws InvalidQueryError If a value is not a member of the enum.
 */
export function enumListParam<T extends number>(
  enumObject: NumericEnum<T>,
  obj: NextSearchParams,
  key: string,
): T[] | undefined {
  return integerListParam(obj, key, 0, INT_MAX)?.map((value) => {
    if (!isValidEnumValue(enumObject, value)) {
      throw new InvalidQueryError(`${key}: Invalid value ${value}`);
    }
    return value;
  });
}

/**
 * Parses a date from a search parameter.
 * Accepts either millisecond timestamps or `Date` constructor strings.
 *
 * @param obj The search params object.
 * @param key The parameter key.
 * @returns The date, or `undefined` if the parameter is absent or empty.
 * @throws InvalidQueryError If the value is not a parseable date.
 */
export function dateParam(
  obj: NextSearchParams,
  key: string,
): Date | undefined {
  const value = expectSingle(obj, key);
  if (value === undefined || value === '') {
    return undefined;
  }

  const date = new Date(/^\d+$/.test(value) ? Number(value) : value);
  if (Number.isNaN(date.getTime())) {
    throw new InvalidQueryError(`${key}: Invalid date ${value}`);
  }

  return date;
}

const TILE_REGEX = /^(\d+)\.(\d+)$/;

function tileFromToken(token: string): Coords | null {
  const match = TILE_REGEX.exec(token);
  return match === null ? null : { x: Number(match[1]), y: Number(match[2]) };
}

function referencedChallenge(stage: Comparator<Stage>): ChallengeType | null {
  if (stage[0] !== '==') {
    return null;
  }
  if (isColosseumStage(stage[1])) {
    return ChallengeType.COLOSSEUM;
  }
  if (isInfernoStage(stage[1])) {
    return ChallengeType.INFERNO;
  }
  return null;
}

/**
 * Parses the value of a `spawn` search parameter into a spawn query.
 *
 * @param value The parameter value.
 * @param type The challenge the search is limited to, if a single one.
 * @returns The spawn query alongside the challenge type it implies.
 * @throws InvalidQueryError If a clause is malformed.
 */
export function spawnQueryValue(
  value: string,
  type: ChallengeType | null,
): [SpawnQuery, ChallengeType | null] {
  const query: SpawnQuery = {
    stage: null,
    values: [],
    tiles: [],
    player: null,
    match: 'contains',
  };
  const tiles: Coords[] = [];
  let challenge = type;

  function implies(implied: ChallengeType | null, clause: string) {
    if (implied === null || implied === challenge) {
      return;
    }
    if (challenge !== null) {
      throw new InvalidQueryError(
        `spawn: ${clause} is not in the ${challengeName(challenge)}`,
      );
    }
    challenge = implied;
  }

  for (const clause of value.split(';')) {
    const colon = clause.indexOf(':');
    if (colon === -1) {
      throw new InvalidQueryError(`spawn: Invalid clause ${clause}`);
    }
    const key = clause.slice(0, colon);
    const arg = clause.slice(colon + 1);

    switch (key) {
      case 'stage':
        query.stage = enumComparatorValue(Stage, arg, 'spawn');
        implies(referencedChallenge(query.stage), clause);
        break;

      case 'npc': {
        const at = arg.indexOf('@');
        const tile = tileFromToken(arg.slice(at + 1));
        const spawn =
          at === -1 || tile === null
            ? null
            : encodeSpawn({ npcId: arg.slice(0, at), ...tile });
        if (spawn === null) {
          throw new InvalidQueryError(`spawn: Invalid npc ${arg}`);
        }
        implies(spawn.type, clause);
        query.values.push(spawn.value);
        break;
      }

      case 'tile': {
        const tile = tileFromToken(arg);
        if (tile === null) {
          throw new InvalidQueryError(`spawn: Invalid tile ${arg}`);
        }
        tiles.push(tile);
        break;
      }

      case 'value':
        query.values.push(integerFromToken(arg, 0, SMALLINT_MAX, 'spawn'));
        break;

      case 'player': {
        const tile = tileFromToken(arg);
        if (tile !== null) {
          const player = encodePlayerTile(tile);
          implies(player.type, clause);
          query.player = player.value;
        } else {
          query.player = integerFromToken(arg, 0, SMALLINT_MAX, 'spawn');
        }
        break;
      }

      case 'match':
        if (arg !== 'exact' && arg !== 'contains') {
          throw new InvalidQueryError(`spawn: Invalid match ${arg}`);
        }
        query.match = arg;
        break;

      default:
        throw new InvalidQueryError(`spawn: Unknown clause ${key}`);
    }
  }

  if (query.match === 'exact' && query.stage?.[0] !== '==') {
    throw new InvalidQueryError('spawn: exact match requires a single stage');
  }

  if (tiles.length > 0) {
    if (challenge === null) {
      throw new InvalidQueryError('spawn: tile requires a stage or type');
    }
    for (const tile of tiles) {
      const values = encodeTile(challenge, tile);
      if (values === null) {
        throw new InvalidQueryError(
          `spawn: invalid spawn tile ${tile.x}.${tile.y}`,
        );
      }
      query.tiles.push(values);
    }
  }

  return [query, challenge];
}
