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

/**
 * Parses a date from a search parameter.
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

  const date = new Date(value);
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

const SMALLINT_MAX = (1 << 15) - 1;

function smallintFromToken(token: string): number | null {
  if (!/^\d+$/.test(token)) {
    return null;
  }
  const value = Number(token);
  return value <= SMALLINT_MAX ? value : null;
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
        query.stage = numericComparatorValue(arg);
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

      case 'value': {
        const stored = smallintFromToken(arg);
        if (stored === null) {
          throw new InvalidQueryError(`spawn: Invalid value ${arg}`);
        }
        query.values.push(stored);
        break;
      }

      case 'player': {
        const tile = tileFromToken(arg);
        if (tile !== null) {
          const player = encodePlayerTile(tile);
          implies(player.type, clause);
          query.player = player.value;
        } else {
          const stored = smallintFromToken(arg);
          if (stored === null) {
            throw new InvalidQueryError(`spawn: Invalid player ${arg}`);
          }
          query.player = stored;
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
