'use server';

import {
  Challenge,
  ChallengeMode,
  ChallengePlayer,
  ChallengeStatus,
  ChallengeType,
  ColosseumChallenge,
  DataRepository,
  Event,
  EventType,
  Player,
  PlayerStats,
  SplitType,
  Stage,
  TobRaid,
  adjustSplitForMode,
  allSplitModes,
  camelToSnake,
  generalizeSplit,
} from '@blert/common';
import postgres from 'postgres';

import { sql } from './db';
import dataRepository from './data-repository';
import { InvalidQueryError } from './errors';
import {
  BaseOperand,
  Comparator,
  Condition,
  InComparator,
  Join,
  RangeComparator,
  join,
  operator,
  where,
} from './query';

/**
 * Fetches the challenge with the specific ID from the database.
 *
 * @param type The type of the challenge.
 * @param id UUID of the challenge.
 * @returns The challenge object if found, `null` if not.
 */
export async function loadChallenge(
  type: ChallengeType,
  id: string,
): Promise<Challenge | null> {
  const rawChallenge = await sql`
    SELECT * from challenges WHERE uuid = ${id} AND type = ${type}
  `;
  if (rawChallenge.length === 0) {
    return null;
  }

  const playersQuery = sql`
    SELECT
      challenge_players.username,
      challenge_players.primary_gear,
      players.username as current_username
    FROM
      challenge_players JOIN players ON challenge_players.player_id = players.id
    WHERE challenge_id = ${rawChallenge[0].id}
    ORDER BY orb
  `;

  const splitsQuery = sql`
    SELECT type, ticks
    FROM challenge_splits
    WHERE challenge_id = ${rawChallenge[0].id}
  `;

  const [players, splits] = await Promise.all([playersQuery, splitsQuery]);

  const splitsMap: Partial<Record<SplitType, number>> = {};
  splits.forEach((split) => {
    splitsMap[generalizeSplit(split.type)] = split.ticks;
  });

  const challenge: Challenge = {
    uuid: rawChallenge[0].uuid,
    type: rawChallenge[0].type,
    stage: rawChallenge[0].stage,
    startTime: rawChallenge[0].start_time,
    status: rawChallenge[0].status,
    mode: rawChallenge[0].mode,
    challengeTicks: rawChallenge[0].challenge_ticks,
    overallTicks: rawChallenge[0].overall_ticks,
    totalDeaths: rawChallenge[0].total_deaths,
    party: players.map((p) => ({
      username: p.username,
      currentUsername: p.current_username,
      primaryGear: p.primary_gear,
    })),
    splits: splitsMap,
  };

  switch (rawChallenge[0].type) {
    case ChallengeType.TOB:
      (challenge as TobRaid).tobRooms =
        await dataRepository.loadTobChallengeData(id);
      break;
    case ChallengeType.COLOSSEUM:
      (challenge as ColosseumChallenge).colosseum =
        await dataRepository.loadColosseumChallengeData(id);
      break;
  }

  return challenge;
}

export type ChallengeOverview = Pick<
  Challenge,
  | 'uuid'
  | 'type'
  | 'stage'
  | 'startTime'
  | 'status'
  | 'mode'
  | 'challengeTicks'
  | 'overallTicks'
  | 'totalDeaths'
> & {
  party: ChallengePlayer[];
  splits?: Partial<Record<SplitType, { ticks: number; accurate: boolean }>>;
};

type SortSuffix = 'nf' | 'nl';

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
export type SortQuery<T> = `${'+' | '-'}${T extends object
  ? keyof T & string
  : T extends string
    ? T
    : never}${`#${SortSuffix}` | ''}`;

export type SortableFields = keyof Omit<ChallengeOverview, 'party'>;

type SingleOrArray<T> = T | T[];

export type ChallengeQuery = {
  type?: Comparator<ChallengeType>;
  mode?: ChallengeMode;
  status?: Comparator<ChallengeStatus>;
  scale?: Comparator<number>;
  party?: string[];
  splits?: Map<SplitType, Comparator<number>>;
  sort?: SingleOrArray<SortQuery<SortableFields>>;
  startTime?: Comparator<Date>;
  challengeTicks?: Comparator<number>;
  customConditions?: Condition[];
};

export type QueryOptions = {
  limit?: number;
  sort?: SortQuery<Omit<ChallengeOverview, 'party'> | Aggregation>;
};

const DEFAULT_CHALLENGE_LIMIT = 10;
const DEFAULT_SORT: SortQuery<SortableFields> = '-startTime';
const DEFAULT_CHALLENGE_QUERY: ChallengeQuery = {
  sort: DEFAULT_SORT,
};

function fieldToTable(field: string): string {
  switch (field) {
    case 'uuid':
    case 'type':
    case 'start_time':
    case 'status':
    case 'stage':
    case 'scale':
    case 'mode':
    case 'challenge_ticks':
    case 'overall_ticks':
    case 'total_deaths':
      return 'challenges';

    case 'username':
      return 'challenge_players';

    default:
      throw new InvalidQueryError(`Unknown field: ${field}`);
  }
}

function comparatorToSql(
  table: postgres.Helper<string>,
  column: string,
  comparator: Comparator<any>,
): postgres.Fragment {
  if (comparator[0] === 'in') {
    const c = comparator as InComparator<any>;
    return sql`${table}.${sql(column)} = ANY(${c[1]})`;
  }

  if (comparator[0] === 'range') {
    const c = comparator as RangeComparator<any>;
    const [start, end] = c[1];
    return sql`${table}.${sql(column)} >= ${start} AND ${table}.${sql(column)} < ${end}`;
  }

  const op = operator(comparator[0]);
  return sql`${table}.${sql(column)} ${op} ${comparator[1]}`;
}

function conditionToSql(
  queryTable: postgres.Helper<string>,
  conditions: Condition,
): postgres.Fragment {
  const columnOrLiteral = (operand: BaseOperand) => {
    if (operand === null) {
      return sql`NULL`;
    }
    if (typeof operand === 'string') {
      const field = camelToSnake(operand);
      return sql`${queryTable}.${sql(field)}`;
    }
    return sql`${operand}`;
  };

  return sql`(
    ${
      Array.isArray(conditions[0])
        ? sql`${conditionToSql(queryTable, conditions[0])}`
        : sql`${columnOrLiteral(conditions[0])}`
    }
    ${operator(conditions[1])}
    ${
      Array.isArray(conditions[2])
        ? sql`${conditionToSql(queryTable, conditions[2])}`
        : sql`${columnOrLiteral(conditions[2])}`
    }
  )`;
}

function order(
  sort: SingleOrArray<string>,
  challengesTable?: postgres.Helper<string>,
): postgres.Fragment {
  const fragments = [];

  const sorts = Array.isArray(sort) ? sort : [sort];
  for (const sort of sorts) {
    let [field, suffix] = sort.slice(1).split('#');
    field = camelToSnake(field);
    let options;
    switch (suffix) {
      case 'nf':
        options = sql`NULLS FIRST`;
        break;
      case 'nl':
        options = sql`NULLS LAST`;
        break;
      default:
        options = sql``;
    }

    if (challengesTable !== undefined) {
      const table = fieldToTable(field);
      const sqlTable = table === 'challenges' ? challengesTable : sql(table);
      if (sort.startsWith('-')) {
        fragments.push(sql`${sqlTable}.${sql(field)} DESC ${options}`);
      } else {
        fragments.push(sql`${sqlTable}.${sql(field)} ASC ${options}`);
      }
    } else {
      fragments.push(
        sort.startsWith('-')
          ? sql`${sql(field)} DESC ${options}`
          : sql`${sql(field)} ASC ${options}`,
      );
    }
  }

  return sql`
    ORDER BY ${fragments.flatMap((f, i) => (i === 0 ? f : [sql`, `, f]))}
  `;
}

type QueryComponents = {
  baseTable: postgres.Fragment;
  queryTable: postgres.Helper<string>;
  joins: Join[];
  conditions: postgres.Fragment[];
};

function applyFilters(query: ChallengeQuery): QueryComponents | null {
  let challengeTable = 'challenges';

  let baseTable = sql`challenges`;
  const joins: Join[] = [];
  const conditions = [];

  if (query.party !== undefined) {
    if (query.party.length === 0) {
      return null;
    }

    if (query.party.length === 1) {
      const username = query.party[0];
      joins.push(
        {
          table: sql`challenge_players`,
          on: sql`challenges.id = challenge_players.challenge_id`,
          tableName: 'challenge_players',
        },
        {
          table: sql`players`,
          on: sql`challenge_players.player_id = players.id`,
          tableName: 'players',
        },
      );
      conditions.push(sql`lower(players.username) = ${username.toLowerCase()}`);
    } else {
      baseTable = sql`(
        SELECT challenges.*
        FROM challenges
        JOIN challenge_players ON challenges.id = challenge_players.challenge_id
        JOIN players ON challenge_players.player_id = players.id
        WHERE lower(players.username) = ANY(${query.party.map((u) => u.toLowerCase())})
        GROUP BY challenges.id
        HAVING COUNT(*) = ${query.party.length}
      ) partied_challenges`;
      challengeTable = 'partied_challenges';
    }
  }

  const sqlChallenges = sql(challengeTable);

  if (query.splits !== undefined && query.splits.size > 0) {
    const splitConditions: postgres.Fragment[] = [];
    for (const [type, comparator] of query.splits) {
      let types: SplitType[];
      if (query.mode !== undefined) {
        types = [adjustSplitForMode(generalizeSplit(type), query.mode)];
      } else {
        types = allSplitModes(generalizeSplit(type));
      }

      const condition = comparatorToSql(
        sql('challenge_splits'),
        'ticks',
        comparator,
      );
      splitConditions.push(
        sql`(challenge_splits.type = ANY(${types}) AND ${condition})`,
      );
    }

    joins.push({
      table: sql`(
        SELECT challenge_id
        FROM challenge_splits
        ${where(splitConditions, 'or')} AND accurate
        GROUP BY challenge_id
        HAVING COUNT(*) = ${splitConditions.length}
      ) filtered_splits`,
      on: sql`${sqlChallenges}.id = filtered_splits.challenge_id`,
      tableName: 'challenges_with_splits',
    });
  }

  if (query.type !== undefined) {
    conditions.push(comparatorToSql(sqlChallenges, 'type', query.type));
  }
  if (query.mode !== undefined) {
    conditions.push(sql`${sqlChallenges}.mode = ${query.mode}`);
  }
  if (query.scale !== undefined) {
    conditions.push(comparatorToSql(sqlChallenges, 'scale', query.scale));
  }

  if (query.status !== undefined) {
    conditions.push(comparatorToSql(sqlChallenges, 'status', query.status));
  } else {
    // Exclude abandoned challenges by default.
    conditions.push(
      sql`${sqlChallenges}.status != ${ChallengeStatus.ABANDONED}`,
    );
  }

  if (query.startTime !== undefined) {
    conditions.push(
      comparatorToSql(sqlChallenges, 'start_time', query.startTime),
    );
  }

  if (query.challengeTicks !== undefined) {
    conditions.push(
      comparatorToSql(sqlChallenges, 'challenge_ticks', query.challengeTicks),
    );
  }

  if (query.customConditions !== undefined) {
    for (const condition of query.customConditions) {
      conditions.push(conditionToSql(sqlChallenges, condition));
    }
  }

  return {
    baseTable,
    queryTable: sqlChallenges,
    joins,
    conditions,
  };
}

export type ExtraChallengeFields = {
  splits?: SplitType[];
};

type FindChallengesOptions = {
  count?: boolean;
  extraFields?: ExtraChallengeFields;
};

/**
 * Fetches basic information about the most recently recorded challenges from
 * the database.
 *
 * @param limit Maximum number of challenges to fetch.
 * @param query Options to filter the challenges.
 * @returns Array of matching challenges.
 * @throws One of the following errors:
 * - `InvalidQueryError` if any parameters in the query are invalid.
 */
export async function findChallenges(
  limit: number = DEFAULT_CHALLENGE_LIMIT,
  query?: ChallengeQuery,
  options: FindChallengesOptions = {},
): Promise<[ChallengeOverview[], number | null]> {
  const searchQuery = { ...DEFAULT_CHALLENGE_QUERY, ...query };

  const components = applyFilters(searchQuery);
  if (components === null) {
    return [[], null];
  }

  const { baseTable, queryTable, joins, conditions } = components;
  const sort = searchQuery.sort ?? DEFAULT_SORT;

  const promises: Promise<any>[] = [
    sql`
      SELECT
        ${queryTable}.id,
        ${queryTable}.uuid,
        ${queryTable}.type,
        ${queryTable}.start_time,
        ${queryTable}.status,
        ${queryTable}.stage,
        ${queryTable}.mode,
        ${queryTable}.challenge_ticks,
        ${queryTable}.overall_ticks,
        ${queryTable}.total_deaths
      FROM ${baseTable}
      ${join(joins)}
      ${where(conditions)}
      ${order(sort, queryTable)}
      LIMIT ${limit}
    `,
  ];

  let total: number | null = null;
  if (options.count) {
    promises.push(
      sql`
        SELECT COUNT(*)
        FROM ${baseTable}
        ${join(joins)}
        ${where(conditions)}
      `.then(([row]) => {
        total = parseInt(row.count);
      }),
    );
  }

  const [rawChallenges] = await Promise.all(promises);

  const challengeIds = rawChallenges.map((c: any) => c.id);
  const extra: Record<number, Partial<ChallengeOverview>> = {};
  for (const id of challengeIds) {
    extra[id] = {};
  }

  const loadPromises: Promise<any>[] = [];

  if (options.extraFields?.splits) {
    const splits = options.extraFields.splits.flatMap(allSplitModes);

    loadPromises.push(
      sql`
        SELECT challenge_id, type, ticks, accurate
        FROM challenge_splits
        WHERE challenge_id = ANY(${challengeIds}) AND type = ANY(${splits})
      `.then((ss) => {
        ss.forEach((s: any) => {
          if (extra[s.challenge_id].splits === undefined) {
            extra[s.challenge_id].splits = {};
          }
          const generalized = generalizeSplit(s.type) as SplitType;
          extra[s.challenge_id].splits![generalized] = {
            ticks: s.ticks,
            accurate: s.accurate,
          };
        });
      }),
    );
  }

  loadPromises.push(
    sql`
      SELECT
        challenge_id,
        challenge_players.username AS username,
        players.username AS current_username,
        primary_gear,
        orb
      FROM challenge_players
      JOIN players ON challenge_players.player_id = players.id
      WHERE challenge_id = ANY(${challengeIds})
      ORDER BY orb
    `.then((players) => {
      players.forEach((p: any) => {
        if (extra[p.challenge_id].party === undefined) {
          extra[p.challenge_id].party = [];
        }
        extra[p.challenge_id].party!.push({
          username: p.username,
          currentUsername: p.current_username,
          primaryGear: p.primary_gear,
        });
      });
    }),
  );

  await Promise.all(loadPromises);

  const challenges = rawChallenges.map(
    // @ts-ignore
    (c: any): ChallengeOverview => ({
      uuid: c.uuid,
      type: c.type,
      startTime: c.start_time,
      status: c.status,
      stage: c.stage,
      mode: c.mode,
      challengeTicks: c.challenge_ticks,
      overallTicks: c.overall_ticks,
      totalDeaths: c.total_deaths,
      ...extra[c.id],
    }),
  );

  return [challenges as ChallengeOverview[], total];
}

type Aggregation = 'count' | 'sum' | 'avg' | 'min' | 'max';
type Aggregations = Aggregation | Aggregation[];

type AggregationQuery = Record<string, Aggregations>;

type FieldAggregations<As extends Aggregations> = As extends Aggregation
  ? { [A in As]: number }
  : As extends Aggregation[]
    ? { [A in As[number]]: number }
    : never;

type AggregationResult<F extends AggregationQuery> = {
  [K in keyof F]: FieldAggregations<F[K]>;
};

type GroupedAggregationResult<
  F extends AggregationQuery,
  G extends string | string[],
> = G extends string
  ? Record<string, AggregationResult<F>>
  : G extends string[]
    ? NestedGroupedAggregationResult<F, G>
    : never;

type NestedGroupedAggregationResult<
  F extends AggregationQuery,
  G extends string[],
> = G extends [infer _, ...infer R]
  ? Record<string, NestedGroupedAggregationResult<F, Extract<R, string[]>>>
  : AggregationResult<F>;

/**
 * Aggregates data from fields of challenges based on the specified query.
 *
 * For example, the following query returns the total number of challenges
 * recorded since 2021/01/01 alongside the sum and average of their ticks:
 *
 * ```typescript
 * const results = await aggregateChallenges(
 *  { from: new Date('2021-01-01') },
 *  { '*': 'count', challengeTicks: ['sum', 'avg'] },
 * );
 *
 * // {
 * //   '*': { count: 10 },
 * //   challengeTicks: { sum: 1234, avg: 123.4 },
 * // }
 * console.log(results);
 * ```
 *
 * @param query Filters to apply to the challenges.
 * @param fields Fields to aggregate and the aggregations to apply.
 * @returns Object mapping fields to their aggregated values. `null` if no
 *   challenges match the query.
 * @throws `InvalidQueryError` if the query is invalid.
 */
export async function aggregateChallenges<F extends AggregationQuery>(
  query: ChallengeQuery,
  fields: F,
): Promise<AggregationResult<F> | null>;

/**
 * Aggregates data from fields of challenges based on the specified query.
 *
 * For example, the following query returns the total number of challenges
 * recorded since 2021/01/01 alongside the sum and average of their ticks:
 *
 * ```typescript
 * const results = await aggregateChallenges(
 *  { from: new Date('2021-01-01') },
 *  { '*': 'count', challengeTicks: ['sum', 'avg'] },
 * );
 *
 * // {
 * //   '*': { count: 10 },
 * //   challengeTicks: { sum: 1234, avg: 123.4 },
 * // }
 * console.log(results);
 * ```
 *
 * @param query Filters to apply to the challenges.
 * @param fields Fields to aggregate and the aggregations to apply.
 * @param options Additional options to apply to the query.
 * @returns Object mapping fields to their aggregated values. `null` if no
 *   challenges match the query.
 * @throws `InvalidQueryError` if the query is invalid.
 */
export async function aggregateChallenges<F extends AggregationQuery>(
  query: ChallengeQuery,
  fields: F,
  options: QueryOptions,
): Promise<AggregationResult<F> | null>;

/**
 * Aggregates data from fields of challenges based on the specified query,
 * grouping the results by the specified field(s).
 *
 * For example, the following query returns the total number of challenges
 * recorded since 2021/01/01 alongside the sum and average of their ticks,
 * grouped by their status:
 *
 * ```typescript
 * const results = await aggregateChallenges(
 *  { from: new Date('2021-01-01') },
 *  { '*': 'count', challengeTicks: ['sum', 'avg'] },
 *  'status',
 * );
 *
 * // {
 * //   '1': { count: 5, challengeTicks: { sum: 780, avg: 156 } },
 * //   '2': { count: 3, challengeTicks: { sum: 281, avg: 93.6666666666667 } },
 * //   '3': { count: 2, challengeTicks: { sum: 173, avg: 86. 5 } },
 * // }
 * console.log(results);
 * ```
 *
 * @param query Filters to apply to the challenges.
 * @param fields Fields to aggregate and the aggregations to apply.
 * @param grouping Field(s) to group the results by.
 * @returns Object mapping fields to their aggregated values. `null` if no
 *   challenges match the query.
 * @throws `InvalidQueryError` if the query is invalid.
 */
export async function aggregateChallenges<
  F extends AggregationQuery,
  G extends string | string[],
>(
  query: ChallengeQuery,
  fields: F,
  options: QueryOptions,
  grouping: G,
): Promise<GroupedAggregationResult<F, G> | null>;

export async function aggregateChallenges<
  F extends AggregationQuery,
  G extends string | string[],
>(
  query: ChallengeQuery,
  fields: F,
  options: QueryOptions = {},
  grouping?: G,
): Promise<AggregationResult<F> | GroupedAggregationResult<F, G> | null> {
  const components = applyFilters(query);
  if (components === null) {
    return null;
  }

  const { baseTable, queryTable, joins, conditions } = components;

  const aggregateName = (field: string, agg: Aggregation): string =>
    `${agg}_${field}`;

  const aggregateFields = Object.entries(fields).flatMap(([field, aggs]) => {
    if (field === '*') {
      if (aggs !== 'count') {
        throw new InvalidQueryError(
          'Cannot aggregate all fields with non-count aggregation',
        );
      }
      return sql`COUNT(*) as count`;
    }

    if (!Array.isArray(aggs)) {
      aggs = [aggs];
    }

    return aggs.map((agg) => {
      const table = fieldToTable(camelToSnake(field));
      const sqlTable = table === 'challenges' ? queryTable : sql(table);
      const name = sql(aggregateName(field, agg));
      return sql`${sql(agg)}(${sqlTable}.${sql(camelToSnake(field))}) as ${name}`;
    });
  });

  let groupFields: string[] = [];
  if (grouping !== undefined) {
    if (Array.isArray(grouping)) {
      groupFields = grouping;
    } else {
      groupFields = [grouping];
    }

    groupFields.forEach((field) => {
      const table = fieldToTable(camelToSnake(field));
      if (
        table === 'challenges' ||
        joins.find((j) => j.tableName === table) !== undefined
      ) {
        return;
      }
      joins.push({
        table: sql(table),
        on: sql`challenges.id = ${sql(table)}.challenge_id`,
        tableName: table,
      });
    });
  }

  const floatOrZero = (value: string | number | null | undefined): number => {
    const num = parseFloat(value as string);
    return Number.isNaN(num) ? 0 : num;
  };

  const rows = await sql`
    SELECT
      ${grouping ? sql`${sql(groupFields)},` : sql``}
      ${aggregateFields.flatMap((f, i) => (i === 0 ? f : [sql`, `, f]))}
    FROM ${baseTable}
    ${join(joins)}
    ${where(conditions)}
    ${grouping ? sql`GROUP BY ${sql(groupFields)}` : sql``}
    ${options.sort ? order(options.sort) : sql``}
    ${options.limit ? sql`LIMIT ${options.limit}` : sql``}
  `;

  if (rows.length === 0) {
    return null;
  }

  if (grouping === undefined) {
    let result = {} as AggregationResult<any>;

    const row = rows[0];
    Object.entries(row).forEach(([key, value]) => {
      if (key === 'count') {
        result['*'] = { count: parseInt(value) };
        return;
      }

      const [agg, field] = key.split('_');

      if (result[field] === undefined) {
        result[field] = {};
      }

      result[field][agg as Aggregation] = floatOrZero(value);
    });

    return result;
  }

  const result = {} as Record<string, any>;

  rows.forEach((row) => {
    let groupResult = {} as any;

    Object.entries(row).forEach(([key, value]) => {
      if (key === 'count') {
        groupResult['*'] = { count: parseInt(value) };
        return;
      }

      if (groupFields.includes(key)) {
        return;
      }

      const [agg, field] = key.split('_');

      if (groupResult[field] === undefined) {
        groupResult[field] = {};
      }

      groupResult[field][agg as Aggregation] = floatOrZero(value);
    });

    let parent = result;

    groupFields.forEach((field, i) => {
      const value = row[field];

      if (i === groupFields.length - 1) {
        parent[value] = groupResult;
      } else if (parent[value] === undefined) {
        parent[value] = {};
      }

      parent = parent[value];
    });
  });

  return result as GroupedAggregationResult<F, G>;
}

/**
 * Returns the party members for each challenge in the list.
 * @param challengeIds List of challenge IDs to look up.
 * @returns Object mapping challenge IDs to an array of party members.
 */
async function loadChallengeParties(
  challengeIds: number[],
): Promise<Record<number, string[]>> {
  const players = await sql`
    SELECT challenge_id, username
    FROM challenge_players
    WHERE challenge_id = ANY(${challengeIds})
    ORDER BY orb
  `;

  return players.reduce((acc, player) => {
    if (acc[player.challenge_id] === undefined) {
      acc[player.challenge_id] = [player.username];
    } else {
      acc[player.challenge_id].push(player.username);
    }
    return acc;
  }, []);
}

/**
 * Fetches all of the events for a specified stage in a challenge.
 * @param challengeId UUID of the challenge.
 * @param stage The stage whose events to fetch.
 * @returns Array of events for the stage, or `null` if the stage does not
 * exist.
 * @throws Any error that occurs while fetching the events.
 */
export async function loadEventsForStage(
  challengeId: string,
  stage: Stage,
  type?: EventType,
): Promise<Event[] | null> {
  try {
    const events = await dataRepository.loadStageEvents(challengeId, stage);
    if (type !== undefined) {
      return events.filter((e) => e.type === type);
    }
    return events;
  } catch (e) {
    if (e instanceof DataRepository.NotFound) {
      return null;
    }
    throw e;
  }
}

export type ChallengeStats = {
  total: number;
  completions: number;
  resets: number;
  wipes: number;
};

export async function loadAggregateChallengeStats(
  type?: ChallengeType,
  mode?: ChallengeMode,
): Promise<ChallengeStats> {
  const conditions = [sql`status != ${ChallengeStatus.IN_PROGRESS}`];

  if (type !== undefined) {
    conditions.push(sql`type = ${type}`);
  }
  if (mode !== undefined) {
    conditions.push(sql`mode = ${mode}`);
  }

  const stats: postgres.RowList<Array<{ status: number; amount: string }>> =
    await sql`
      SELECT status, COUNT(*) as amount
      FROM challenges
      ${where(conditions)}
      GROUP BY status
    `;

  return stats.reduce(
    (acc, stat) => {
      const amount = parseInt(stat.amount);
      if (stat.status === ChallengeStatus.COMPLETED) {
        acc.completions = amount;
      } else if (stat.status === ChallengeStatus.RESET) {
        acc.resets = amount;
      } else if (stat.status === ChallengeStatus.WIPED) {
        acc.wipes = amount;
      }
      acc.total += amount;
      return acc;
    },
    { total: 0, completions: 0, resets: 0, wipes: 0 },
  );
}

export type PlayerWithStats = Pick<Player, 'username' | 'totalRecordings'> & {
  stats: Omit<PlayerStats, 'playerId' | 'date'>;
};

/**
 * Looks up a player by their username and fetches their most recent stats.
 * @param username The player's username.
 * @returns The player and their stats if found, `null` if not.
 */
export async function loadPlayerWithStats(
  username: string,
): Promise<PlayerWithStats | null> {
  const [playerWithStats] = await sql`
    SELECT
      players.username,
      players.total_recordings,
      player_stats.*
    FROM players
    JOIN player_stats ON players.id = player_stats.player_id
    WHERE lower(players.username) = ${username.toLowerCase()}
    ORDER BY player_stats.date DESC
    LIMIT 1
  `;

  if (!playerWithStats) {
    return null;
  }

  return {
    username: playerWithStats.username,
    totalRecordings: playerWithStats.total_recordings,
    stats: {
      tobCompletions: playerWithStats.tob_completions,
      tobWipes: playerWithStats.tob_wipes,
      tobResets: playerWithStats.tob_resets,
      colosseumCompletions: playerWithStats.colosseum_completions,
      colosseumWipes: playerWithStats.colosseum_wipes,
      colosseumResets: playerWithStats.colosseum_resets,
      deathsTotal: playerWithStats.deaths_total,
      deathsMaiden: playerWithStats.deaths_maiden,
      deathsBloat: playerWithStats.deaths_bloat,
      deathsNylocas: playerWithStats.deaths_nylocas,
      deathsSotetseg: playerWithStats.deaths_sotetseg,
      deathsXarpus: playerWithStats.deaths_xarpus,
      deathsVerzik: playerWithStats.deaths_verzik,
      bgsSmacks: playerWithStats.bgs_smacks,
      hammerBops: playerWithStats.hammer_bops,
      challyPokes: playerWithStats.chally_pokes,
      unchargedScytheSwings: playerWithStats.uncharged_scythe_swings,
      ralosAutos: playerWithStats.ralos_autos,
      elderMaulSmacks: playerWithStats.elder_maul_smacks,
      tobBarragesWithoutProperWeapon:
        playerWithStats.tob_barrages_without_proper_weapon,
      tobVerzikP1TrollSpecs: playerWithStats.tob_verzik_p1_troll_specs,
      tobVerzikP3Melees: playerWithStats.tob_verzik_p3_melees,
      chinsThrownTotal: playerWithStats.chins_thrown_total,
      chinsThrownBlack: playerWithStats.chins_thrown_black,
      chinsThrownRed: playerWithStats.chins_thrown_red,
      chinsThrownGrey: playerWithStats.chins_thrown_grey,
      chinsThrownMaiden: playerWithStats.chins_thrown_maiden,
      chinsThrownNylocas: playerWithStats.chins_thrown_nylocas,
      chinsThrownValue: playerWithStats.chins_thrown_value,
      chinsThrownIncorrectlyMaiden:
        playerWithStats.chins_thrown_incorrectly_maiden,
    },
  };
}

export type PersonalBest = {
  type: SplitType;
  cid: string;
  scale: number;
  ticks: number;
};

export async function loadPbsForPlayer(
  username: string,
): Promise<PersonalBest[]> {
  const pbs: postgres.RowList<Array<PersonalBest>> = await sql`
    SELECT
      challenges.uuid as cid,
      challenge_splits.type,
      challenge_splits.scale,
      challenge_splits.ticks
    FROM personal_bests
    JOIN challenge_splits ON personal_bests.challenge_split_id = challenge_splits.id
    JOIN players ON personal_bests.player_id = players.id
    JOIN challenges ON challenge_splits.challenge_id = challenges.id
    WHERE lower(players.username) = ${username.toLowerCase()}
  `;

  return pbs;
}

function stageToStatsField(stage: Stage): string | null {
  switch (stage) {
    case Stage.TOB_MAIDEN:
      return 'deaths_maiden';
    case Stage.TOB_BLOAT:
      return 'deaths_bloat';
    case Stage.TOB_NYLOCAS:
      return 'deaths_nylocas';
    case Stage.TOB_SOTETSEG:
      return 'deaths_sotetseg';
    case Stage.TOB_XARPUS:
      return 'deaths_xarpus';
    case Stage.TOB_VERZIK:
      return 'deaths_verzik';
    default:
      return null;
  }
}

export async function getTotalDeathsByStage(
  stages: Stage[],
): Promise<Record<Stage, number>> {
  const statsFields: Array<[Stage, string]> = [];
  const otherStages: Stage[] = [];

  for (const stage of stages) {
    const field = stageToStatsField(stage);
    if (field !== null) {
      statsFields.push([stage, field]);
    } else {
      otherStages.push(stage);
    }
  }

  const deathsByStage = {} as Record<Stage, number>;
  const promises = [];

  if (statsFields.length > 0) {
    const baseColumns = statsFields.map(([, field]) => field);
    const aggregateColumns = statsFields.flatMap(([stage, field], i) => {
      const sum = sql`SUM(${sql(field)}) AS ${sql(stage.toString())}`;
      return i > 0 ? [sql`, `, sum] : sum;
    });

    promises.push(
      await sql`
      SELECT ${aggregateColumns} FROM (
        SELECT DISTINCT ON (player_id) ${sql(baseColumns)}
        FROM player_stats
        ORDER BY player_id, date DESC
      );
    `.then(([stagesAndDeaths]) => {
        Object.entries(stagesAndDeaths).forEach(([stage, deaths]) => {
          deathsByStage[parseInt(stage)] = parseInt(deaths);
        });
      }),
    );
  }

  if (otherStages.length > 0) {
    promises.push(
      await sql`
      SELECT stage, COUNT(*) as deaths
      FROM queryable_events
      WHERE event_type = ${EventType.PLAYER_DEATH} AND stage = ANY(${otherStages})
      GROUP BY stage
    `.then((stagesAndDeaths) => {
        for (const row of stagesAndDeaths) {
          deathsByStage[row.stage] = parseInt(row.deaths);
        }
      }),
    );
  }

  await Promise.all(promises);
  return deathsByStage;
}

export type RankedSplit = {
  uuid: string;
  date: Date;
  ticks: number;
  party: string[];
};

/**
 * Returns the top `numRanks` split times for each split type and scale.
 *
 * The returned split times are unique. If multiple challenges have the same
 * time, the earliest one recorded is returned.
 *
 * @param types The split types to fetch.
 * @param scale The challenge scale.
 * @param numRanks How many split times to fetch for each split type.
 * @returns Object mapping split types to an array of ranked split times.
 */
export async function findBestSplitTimes(
  types: SplitType[],
  scale: number,
  numRanks: number,
): Promise<{ [split in SplitType]?: RankedSplit[] }> {
  const rankedSplits: { [split in SplitType]?: RankedSplit[] } = {};
  const partiesToUpdate: Array<[number, any]> = [];

  await Promise.all(
    types.map(async (type) => {
      const results: Array<{
        id: number;
        uuid: string;
        start_time: Date;
        type: SplitType;
        scale: number;
        ticks: number;
      }> = await sql`
        SELECT DISTINCT ON (ticks)
          challenges.id,
          challenges.uuid,
          challenges.start_time,
          challenge_splits.type,
          challenge_splits.scale,
          challenge_splits.ticks
        FROM challenge_splits
        JOIN challenges ON challenge_splits.challenge_id = challenges.id
        WHERE
          challenge_splits.accurate
          AND challenge_splits.type = ${type}
          AND challenge_splits.scale = ${scale}
        ORDER BY challenge_splits.ticks, challenges.start_time
        LIMIT ${numRanks};
      `;

      results.forEach((r) => {
        if (rankedSplits[type] === undefined) {
          rankedSplits[type] = [];
        }

        const rankedSplit = {
          uuid: r.uuid,
          date: r.start_time,
          ticks: r.ticks,
          party: [],
        };

        rankedSplits[type]!.push(rankedSplit);
        partiesToUpdate.push([r.id, rankedSplit]);
      });
    }),
  );

  const parties = await loadChallengeParties(partiesToUpdate.map((p) => p[0]));
  for (const [id, desc] of partiesToUpdate) {
    desc.party = parties[id];
  }

  return rankedSplits;
}
