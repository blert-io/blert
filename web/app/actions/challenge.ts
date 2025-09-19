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
  InfernoChallenge,
  InfernoChallengeStats,
  MokhaiotlChallenge,
  MokhaiotlChallengeStats,
  Player,
  PlayerStats,
  RELEVANT_PB_SPLITS,
  Session,
  SessionStatus,
  SplitType,
  Stage,
  TobChallengeStats,
  TobRaid,
  allSplitModes,
  camelToSnake,
  generalizeSplit,
  isPostgresInvalidTextRepresentation,
  isPostgresUndefinedColumn,
  snakeToCamel,
  snakeToCamelObject,
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
    SELECT
      challenges.*,
      challenge_sessions.uuid as session_uuid
    FROM challenges
    JOIN challenge_sessions ON challenges.session_id = challenge_sessions.id
    WHERE challenges.uuid = ${id} AND challenges.type = ${type}
  `;
  if (rawChallenge.length === 0) {
    return null;
  }

  const playersQuery = sql`
    SELECT
      challenge_players.username,
      challenge_players.primary_gear,
      challenge_players.stage_deaths,
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
    sessionUuid: rawChallenge[0].session_uuid,
    type: rawChallenge[0].type,
    stage: rawChallenge[0].stage,
    startTime: rawChallenge[0].start_time,
    finishTime: rawChallenge[0].finish_time,
    status: rawChallenge[0].status,
    mode: rawChallenge[0].mode,
    scale: rawChallenge[0].scale,
    challengeTicks: rawChallenge[0].challenge_ticks,
    overallTicks: rawChallenge[0].overall_ticks,
    totalDeaths: rawChallenge[0].total_deaths,
    party: players.map((p) => ({
      username: p.username,
      currentUsername: p.current_username,
      primaryGear: p.primary_gear,
      deaths: p.stage_deaths,
    })),
    splits: splitsMap,
  };

  switch (rawChallenge[0].type) {
    case ChallengeType.TOB: {
      const raid = challenge as TobRaid;

      await Promise.all([
        dataRepository.loadTobChallengeData(id),
        sql`
          SELECT *
          FROM tob_challenge_stats
          WHERE challenge_id = ${rawChallenge[0].id}
        `,
      ]).then(([tobData, [stats]]) => {
        raid.tobRooms = tobData;
        if (stats) {
          raid.tobStats = statsObject(stats);
        }
      });

      if (!raid.tobStats) {
        return null;
      }

      break;
    }

    case ChallengeType.COLOSSEUM:
      (challenge as ColosseumChallenge).colosseum =
        await dataRepository.loadColosseumChallengeData(id);
      break;

    case ChallengeType.INFERNO:
      await Promise.all([
        dataRepository.loadInfernoChallengeData(id),
        sql`
          SELECT *
          FROM inferno_challenge_stats
          WHERE challenge_id = ${rawChallenge[0].id}
        `,
      ]).then(([infernoData, [stats]]) => {
        (challenge as InfernoChallenge).inferno = infernoData;
        if (stats) {
          (challenge as InfernoChallenge).infernoStats = statsObject(stats);
        }
      });
      break;

    case ChallengeType.MOKHAIOTL:
      await Promise.all([
        dataRepository.loadMokhaiotlChallengeData(id),
        sql`
          SELECT *
          FROM mokhaiotl_challenge_stats
          WHERE challenge_id = ${rawChallenge[0].id}
        `,
      ]).then(([mokhaiotlData, [stats]]) => {
        (challenge as MokhaiotlChallenge).mokhaiotl = mokhaiotlData;
        if (stats) {
          (challenge as MokhaiotlChallenge).mokhaiotlStats = statsObject(stats);
        }
      });
      break;
  }

  return challenge;
}

function statsTableAndField(type: ChallengeType): {
  table: string;
  field: keyof Pick<
    SessionChallenge,
    'tobStats' | 'mokhaiotlStats' | 'infernoStats'
  >;
} | null {
  switch (type) {
    case ChallengeType.TOB:
      return { table: 'tob_challenge_stats', field: 'tobStats' };
    case ChallengeType.MOKHAIOTL:
      return { table: 'mokhaiotl_challenge_stats', field: 'mokhaiotlStats' };
    case ChallengeType.INFERNO:
      return { table: 'inferno_challenge_stats', field: 'infernoStats' };
    default:
      return null;
  }
}

function statsObject<
  T extends TobChallengeStats | MokhaiotlChallengeStats | InfernoChallengeStats,
>(rawRow: Record<string, any>): T {
  delete rawRow.id;
  delete rawRow.challenge_id;
  return snakeToCamelObject(rawRow) as T;
}

export type SplitValue = {
  ticks: number;
  accurate: boolean;
};

export type ChallengeOverview = Pick<
  Challenge,
  | 'uuid'
  | 'sessionUuid'
  | 'type'
  | 'stage'
  | 'scale'
  | 'startTime'
  | 'finishTime'
  | 'status'
  | 'mode'
  | 'challengeTicks'
  | 'overallTicks'
  | 'totalDeaths'
> & {
  party: ChallengePlayer[];
  splits?: Partial<Record<SplitType, SplitValue>>;
} & Partial<
    Pick<TobRaid, 'tobStats'> &
      Pick<MokhaiotlChallenge, 'mokhaiotlStats'> &
      Pick<InfernoChallenge, 'infernoStats'>
  >;

type SortDirection = '+' | '-';
type SortOptions = 'nf' | 'nl';

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

function isSortDirection(s: string): s is SortDirection {
  return s === '+' || s === '-';
}
function isSortOptions(s: string): s is SortOptions {
  return s === 'nf' || s === 'nl';
}

export type BasicSortableFields = keyof Omit<
  ChallengeOverview,
  'party' | 'finishTime'
>;
export type SplitSortableFields = `splits:${SplitType}`;
export type MokhaiotlSortableFields =
  `mok:${keyof Pick<MokhaiotlChallengeStats, 'maxCompletedDelve'>}`;
export type SortableFields =
  | BasicSortableFields
  | SplitSortableFields
  | MokhaiotlSortableFields;

type SingleOrArray<T> = T | T[];

export type ChallengeQuery = {
  uuid?: string[];
  session?: number[] | string[];
  type?: Comparator<ChallengeType>;
  mode?: SingleOrArray<ChallengeMode>;
  status?: Comparator<ChallengeStatus>;
  scale?: Comparator<number>;
  party?: string[];
  splits?: Map<SplitType, Comparator<number>>;
  sort?: SingleOrArray<SortQuery<SortableFields>>;
  startTime?: Comparator<Date>;
  challengeTicks?: Comparator<number>;
  customConditions?: Condition[];
  stage?: Comparator<Stage>;
};

export type QueryOptions = {
  accurateSplits?: boolean;
  fullRecordings?: boolean;
  limit?: number;
  sort?: SortQuery<
    Omit<ChallengeOverview, 'party' | 'finishTime'> | Aggregation
  >;
};

const DEFAULT_CHALLENGE_LIMIT = 10;
const DEFAULT_SORT: SortQuery<SortableFields> = '-startTime';
const DEFAULT_CHALLENGE_QUERY: ChallengeQuery = {
  sort: DEFAULT_SORT,
};

function splitsTableName(split: SplitType) {
  return `challenge_splits_${split}`;
}

function shorthandToFullField(field: string): [string, string] {
  if (field.startsWith('splits:')) {
    const split = field.slice(7);
    return ['ticks', splitsTableName(parseInt(split))];
  }

  if (field.startsWith('mok:')) {
    const mokField = field.slice(4);
    return [mokField, 'mokhaiotl_challenge_stats'];
  }

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
      return [field, 'challenges'];

    case 'username':
      return [field, 'challenge_players'];

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
  challengesTable: postgres.Helper<string>,
  conditions: Condition,
): postgres.Fragment {
  const columnOrLiteral = (operand: BaseOperand) => {
    if (operand === null) {
      return sql`NULL`;
    }
    if (typeof operand === 'string') {
      const field = camelToSnake(operand);
      const [tableField, table] = shorthandToFullField(field);
      const sqlTable = table === 'challenges' ? challengesTable : sql(table);
      return sql`${sqlTable}.${sql(tableField)}`;
    }
    return sql`${operand}`;
  };

  return sql`(
    ${
      Array.isArray(conditions[0])
        ? sql`${conditionToSql(challengesTable, conditions[0])}`
        : sql`${columnOrLiteral(conditions[0])}`
    }
    ${operator(conditions[1])}
    ${
      Array.isArray(conditions[2])
        ? sql`${conditionToSql(challengesTable, conditions[2])}`
        : sql`${columnOrLiteral(conditions[2])}`
    }
  )`;
}

function parseSort(sort: string): {
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

function order(
  sort: SingleOrArray<string>,
  challengesTable?: postgres.Helper<string>,
): postgres.Fragment {
  const fragments = [];

  const sorts = Array.isArray(sort) ? sort : [sort];
  for (const sort of sorts) {
    let { direction, field, options } = parseSort(sort);
    field = camelToSnake(field);
    let sortOptions;
    switch (options) {
      case 'nf':
        sortOptions = sql`NULLS FIRST`;
        break;
      case 'nl':
        sortOptions = sql`NULLS LAST`;
        break;
      default:
        sortOptions = sql``;
    }

    if (challengesTable !== undefined) {
      const [tableField, table] = shorthandToFullField(field);
      const sqlTable = table === 'challenges' ? challengesTable : sql(table);
      if (direction === '-') {
        fragments.push(sql`${sqlTable}.${sql(tableField)} DESC ${sortOptions}`);
      } else {
        fragments.push(sql`${sqlTable}.${sql(tableField)} ASC ${sortOptions}`);
      }
    } else {
      fragments.push(
        direction === '-'
          ? sql`${sql(field)} DESC ${sortOptions}`
          : sql`${sql(field)} ASC ${sortOptions}`,
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

function addSplitsTable(
  split: SplitType,
  baseTable: postgres.Helper<string, string[]>,
  joins: Join[],
  conditions: postgres.Fragment[],
  accurateSplits?: boolean,
) {
  const table = splitsTableName(split);
  joins.push({
    table: sql`(
        SELECT challenge_id, ticks, accurate
        FROM challenge_splits
        WHERE type = ANY(${allSplitModes(generalizeSplit(split))})
      ) ${sql(table)}`,
    on: sql`${baseTable}.id = ${sql(table)}.challenge_id`,
    type: 'left',
    tableName: table,
  });

  if (accurateSplits) {
    conditions.push(sql`${sql(table)}.accurate`);
  }
}

function applyFilters(
  query: ChallengeQuery,
  defaultJoins: Join[] = [],
  accurateSplits?: boolean,
  fullRecordings?: boolean,
): QueryComponents | null {
  let baseTable = sql`challenges`;
  const joins: Join[] = defaultJoins;
  const conditions = [];

  if (query.uuid !== undefined) {
    conditions.push(sql`challenges.uuid = ANY(${query.uuid})`);
  }

  if (query.session !== undefined && query.session.length > 0) {
    if (typeof query.session[0] === 'number') {
      conditions.push(sql`challenges.session_id = ANY(${query.session})`);
    } else {
      conditions.push(sql`challenge_sessions.uuid = ANY(${query.session})`);
      joins.push({
        table: sql`challenge_sessions`,
        on: sql`challenges.session_id = challenge_sessions.id`,
        tableName: 'challenge_sessions',
      });
    }
  }

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
      ) challenges`;
    }
  }

  const sqlChallenges = sql('challenges');

  if (query.splits !== undefined && query.splits.size > 0) {
    const splitConditions: postgres.Fragment[] = [];
    for (const [type, comparator] of query.splits) {
      const types = allSplitModes(generalizeSplit(type));
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

  if (query.sort !== undefined) {
    const sorts = Array.isArray(query.sort) ? query.sort : [query.sort];
    for (const sort of sorts) {
      const sortKey = sort.slice(1).split('#')[0];
      if (sortKey.startsWith('splits:')) {
        const split = parseInt(sortKey.slice(7)) as SplitType;
        addSplitsTable(split, sqlChallenges, joins, conditions, accurateSplits);
      }

      if (sortKey.startsWith('mok:')) {
        joins.push({
          table: sql`mokhaiotl_challenge_stats`,
          on: sql`${sqlChallenges}.id = mokhaiotl_challenge_stats.challenge_id`,
          tableName: 'mokhaiotl_challenge_stats',
        });
      }
    }
  }

  if (query.type !== undefined) {
    conditions.push(comparatorToSql(sqlChallenges, 'type', query.type));
  }
  if (query.mode !== undefined) {
    const modes = Array.isArray(query.mode) ? query.mode : [query.mode];
    conditions.push(sql`${sqlChallenges}.mode = ANY(${modes})`);
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

  if (query.stage !== undefined) {
    conditions.push(comparatorToSql(sqlChallenges, 'stage', query.stage));
  }

  if (query.customConditions !== undefined) {
    for (const condition of query.customConditions) {
      conditions.push(conditionToSql(sqlChallenges, condition));
    }
  }

  if (fullRecordings) {
    conditions.push(sql`${sqlChallenges}.full_recording = true`);
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
  stats?: boolean;
};

export type FindChallengesOptions = {
  /**
   * When sorting by split times, whether to filter out inaccurate splits.
   */
  accurateSplits?: boolean;

  /**
   * Additionally returns the number of matching challenges as the second value
   * in the result tuple. If not set, the second value will be `null`.
   */
  count?: boolean;

  /**
   * Exclude challenges that are missing data for any of their stages.
   */
  fullRecordings?: boolean;

  /**
   * Additional fields to include in the result set.
   */
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
  limit: number | null = DEFAULT_CHALLENGE_LIMIT,
  query?: ChallengeQuery,
  options: FindChallengesOptions = {},
): Promise<[ChallengeOverview[], number | null]> {
  const searchQuery = { ...DEFAULT_CHALLENGE_QUERY, ...query };

  if (limit === null) {
    if (query?.uuid === undefined && query?.session === undefined) {
      throw new Error(
        'Must specify list of UUIDs or sessions to fetch without a limit',
      );
    }
  }

  const defaultJoins: Join[] = [
    {
      table: sql`challenge_sessions`,
      on: sql`challenges.session_id = challenge_sessions.id`,
      tableName: 'challenge_sessions',
    },
  ];

  const components = applyFilters(
    searchQuery,
    defaultJoins,
    options.accurateSplits,
    options.fullRecordings,
  );
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
        ${queryTable}.session_id,
        ${queryTable}.type,
        ${queryTable}.start_time,
        ${queryTable}.finish_time,
        ${queryTable}.status,
        ${queryTable}.stage,
        ${queryTable}.mode,
        ${queryTable}.scale,
        ${queryTable}.challenge_ticks,
        ${queryTable}.overall_ticks,
        ${queryTable}.total_deaths,
        challenge_sessions.uuid AS session_uuid
      FROM ${baseTable}
      ${join(joins)}
      ${where(conditions)}
      ${order(sort, queryTable)}
      ${limit !== null ? sql`LIMIT ${limit}` : sql``}
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

  if (options.extraFields?.stats) {
    const types = new Map<ChallengeType, number[]>();
    for (const c of rawChallenges) {
      const list = types.get(c.type) ?? [];
      types.set(c.type, [...list, c.id]);
    }

    if (types.has(ChallengeType.TOB)) {
      loadPromises.push(
        sql`
          SELECT *
          FROM tob_challenge_stats
          WHERE challenge_id = ANY(${types.get(ChallengeType.TOB)!})
        `.then((stats) => {
          stats.forEach((s: any) => {
            const challengeId = s.challenge_id;
            delete s.id;
            delete s.challenge_id;
            extra[challengeId].tobStats = snakeToCamelObject(s);
          });
        }),
      );
    }

    if (types.has(ChallengeType.MOKHAIOTL)) {
      loadPromises.push(
        sql`
          SELECT *
          FROM mokhaiotl_challenge_stats
          WHERE challenge_id = ANY(${types.get(ChallengeType.MOKHAIOTL)!})
        `.then((stats) => {
          stats.forEach((s: any) => {
            const challengeId = s.challenge_id;
            delete s.id;
            delete s.challenge_id;
            extra[challengeId].mokhaiotlStats = snakeToCamelObject(s);
          });
        }),
      );
    }

    if (types.has(ChallengeType.INFERNO)) {
      loadPromises.push(
        sql`
          SELECT *
          FROM inferno_challenge_stats
          WHERE challenge_id = ANY(${types.get(ChallengeType.INFERNO)!})
        `.then((stats) => {
          stats.forEach((s: any) => {
            const challengeId = s.challenge_id;
            delete s.id;
            delete s.challenge_id;
            extra[challengeId].infernoStats = snakeToCamelObject(s);
          });
        }),
      );
    }
  }

  loadPromises.push(
    sql`
      SELECT
        challenge_id,
        challenge_players.username AS username,
        challenge_players.stage_deaths,
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
          deaths: p.stage_deaths,
        });
      });
    }),
  );

  await Promise.all(loadPromises);

  const challenges = rawChallenges.map(
    (c: any): ChallengeOverview => ({
      uuid: c.uuid,
      sessionUuid: c.session_uuid,
      type: c.type,
      startTime: c.start_time,
      finishTime: c.finish_time,
      status: c.status,
      stage: c.stage,
      mode: c.mode,
      scale: c.scale,
      challengeTicks: c.challenge_ticks,
      overallTicks: c.overall_ticks,
      totalDeaths: c.total_deaths,
      ...(extra[c.id] as Partial<ChallengeOverview> & {
        party: ChallengeOverview['party'];
      }),
    }),
  );

  return [challenges as ChallengeOverview[], total];
}

type GroupField = {
  field: string;
  renamed: string;
  groupExpression: postgres.Fragment | null;
};

function groupExpression(groupField: GroupField): postgres.Fragment {
  if (groupField.groupExpression === null) {
    return sql`${sql(groupField.field)}`;
  }
  return sql`${groupField.groupExpression} AS ${sql(groupField.renamed)}`;
}

export type Aggregation = 'count' | 'sum' | 'avg' | 'min' | 'max';
type Aggregations = Aggregation | Aggregation[];

function isAggregation(agg: string): agg is Aggregation {
  return ['count', 'sum', 'avg', 'min', 'max'].includes(agg);
}

export type AggregationQuery = Record<string, Aggregations>;

export type FieldAggregation<T extends string> = `${T}:${Aggregation}`;

type FieldAggregations<As extends Aggregations> = As extends Aggregation
  ? { [A in As]: number }
  : As extends Aggregation[]
    ? { [A in As[number]]: number }
    : never;

export type AggregationResult<F extends AggregationQuery> = {
  [K in keyof F]: FieldAggregations<F[K]>;
};

export type GroupedAggregationResult<
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
> = G extends [string, ...infer R]
  ? R extends string[]
    ? { [key: string]: NestedGroupedAggregationResult<F, R> }
    : never
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
  const components = applyFilters(
    query,
    [],
    options.accurateSplits,
    options.fullRecordings,
  );
  if (components === null) {
    return null;
  }

  const { baseTable, queryTable, joins, conditions } = components;

  const aggregateName = (
    table: string,
    field: string,
    agg: Aggregation,
  ): string => `${agg}_${table}_${field}`;

  const originalFields: Record<string, string> = {};
  let hasCount = false;

  const aggregateFields = Object.entries(fields).flatMap(([field, aggs]) => {
    if (field === '*') {
      if (aggs !== 'count') {
        throw new InvalidQueryError(
          'Cannot aggregate all fields with non-count aggregation',
        );
      }
      hasCount = true;
      return sql`COUNT(*) as count`;
    }

    if (!Array.isArray(aggs)) {
      aggs = [aggs];
    }

    const [tableField, table] = shorthandToFullField(camelToSnake(field));
    const sqlTable = table === 'challenges' ? queryTable : sql(table);

    if (field.startsWith('splits:')) {
      const split = parseInt(field.slice(7)) as SplitType;
      addSplitsTable(
        split,
        queryTable,
        joins,
        conditions,
        options.accurateSplits,
      );
    }

    return aggs.map((agg) => {
      const name = aggregateName(table, tableField, agg);
      originalFields[name] = field;
      return sql`${sql(agg)}(${sqlTable}.${sql(tableField)}) as ${sql(name)}`;
    });
  });

  let groupFields: Array<GroupField> = [];

  if (grouping !== undefined) {
    const fields = Array.isArray(grouping) ? grouping : [grouping];
    fields.forEach((field) => {
      const [f, table] = shorthandToFullField(camelToSnake(field));
      let groupExpression = null;
      let renamed = f;

      if (
        table === 'challenges' ||
        joins.find((j) => j.tableName === table) !== undefined
      ) {
        if (field === 'startTime') {
          renamed = 'start_date';
          groupExpression = sql`${sql(f)}::date`;
        }
      } else {
        joins.push({
          table: sql(table),
          on: sql`challenges.id = ${sql(table)}.challenge_id`,
          tableName: table,
        });
      }
      groupFields.push({ field: f, renamed, groupExpression });
    });
  }

  const floatOrZero = (value: string | number | null | undefined): number => {
    const num = parseFloat(value as string);
    return Number.isNaN(num) ? 0 : num;
  };

  const rows = await sql`
    SELECT
      ${
        groupFields.length > 0
          ? sql`${groupFields.map((g) => sql`${groupExpression(g)},`)}`
          : sql``
      }
      ${aggregateFields.flatMap((f, i) => (i === 0 ? f : [sql`, `, f]))}
    FROM ${baseTable}
    ${join(joins)}
    ${where(conditions)}
    ${
      groupFields.length > 0
        ? sql`GROUP BY ${sql(groupFields.map((g) => g.renamed))}`
        : sql``
    }
    ${options.sort ? order(options.sort) : sql``}
    ${options.limit ? sql`LIMIT ${options.limit}` : sql``}
  `;

  if (rows.length === 0) {
    if (groupFields.length > 0) {
      return {} as any;
    }
    if (hasCount) {
      return { '*': { count: 0 } } as any;
    }
    return null;
  }

  if (groupFields.length === 0) {
    let result = {} as AggregationResult<any>;

    const row = rows[0];

    Object.entries(row).forEach(([key, value]) => {
      if (key === 'count') {
        result['*'] = { count: parseInt(value) };
        return;
      }

      const agg = key.split('_')[0];
      const field = originalFields[key];

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

      if (groupFields.some((g) => g.renamed === key)) {
        return;
      }

      const agg = key.split('_')[0];
      const field = originalFields[key];

      if (groupResult[field] === undefined) {
        groupResult[field] = {};
      }

      groupResult[field][agg as Aggregation] = floatOrZero(value);
    });

    let parent = result;

    groupFields.forEach((field, i) => {
      let value = row[field.renamed];
      if (value instanceof Date) {
        const date = value as Date;
        value =
          `${date.getUTCFullYear()}-` +
          `${(date.getUTCMonth() + 1).toString().padStart(2, '0')}-` +
          `${date.getUTCDate().toString().padStart(2, '0')}`;
      }

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

export type SessionQuery = {
  type?: Comparator<ChallengeType>;
  mode?: SingleOrArray<ChallengeMode>;
  scale?: Comparator<number>;
  startTime?: Comparator<Date>;
  status?: Comparator<SessionStatus>;
  party?: string[];
};

type SessionSortableFields = Pick<Session, 'startTime' | 'endTime' | 'status'>;

export type SessionWithChallenges = Omit<Session, 'partyHash'> & {
  party: string[];
  challenges: ChallengeOverview[];
};

function sessionFilters(query: SessionQuery): {
  conditions: postgres.Fragment[];
  defaultSort: SingleOrArray<SortQuery<SessionSortableFields>>;
} {
  const conditions: postgres.Fragment[] = [];
  let defaultSort: SingleOrArray<SortQuery<SessionSortableFields>> =
    '-startTime';

  if (query.type !== undefined) {
    conditions.push(
      comparatorToSql(sql('challenge_sessions'), 'challenge_type', query.type),
    );
  }

  if (query.mode !== undefined) {
    const mode = Array.isArray(query.mode) ? query.mode : [query.mode];
    conditions.push(sql`challenge_sessions.challenge_mode = ANY(${mode})`);
  }

  if (query.scale !== undefined) {
    conditions.push(
      comparatorToSql(sql('challenge_sessions'), 'scale', query.scale),
    );
  }

  if (query.startTime !== undefined) {
    conditions.push(
      comparatorToSql(sql('challenge_sessions'), 'start_time', query.startTime),
    );
  }

  if (query.status !== undefined) {
    conditions.push(
      comparatorToSql(sql('challenge_sessions'), 'status', query.status),
    );
  } else {
    conditions.push(sql`challenge_sessions.status != ${SessionStatus.HIDDEN}`);

    // Ensure active sessions are at the top.
    defaultSort = ['+status', '-startTime'];
  }

  if (query.party) {
    if (query.party.length === 1) {
      conditions.push(
        sql`
          challenge_sessions.id IN (
            SELECT DISTINCT(c.session_id)
            FROM challenge_players cp
            JOIN players p ON p.id = cp.player_id
            JOIN challenges c ON c.id = cp.challenge_id
            WHERE LOWER(p.username) = ${query.party[0].toLowerCase()}
          )
        `,
      );
    } else {
      conditions.push(
        sql`
          challenge_sessions.id IN (
            SELECT DISTINCT(c.session_id)
            FROM challenge_players cp
            JOIN players p ON p.id = cp.player_id
            JOIN challenges c ON c.id = cp.challenge_id
            WHERE LOWER(p.username) = ANY(${query.party.map((u) => u.toLowerCase())})
            GROUP BY c.id
            HAVING COUNT(*) = ${query.party.length}
          )
        `,
      );
    }
  }

  return { conditions, defaultSort };
}

export type SessionStats = {
  challenges: number;
  completions: number;
  wipes: number;
  resets: number;
  deaths: number;
  /** Percentage of challenges completed. */
  completionRate: number;
  /** Fastest completed challenge time. */
  minCompletionTicks: number;
  /** Slowest completed challenge time. */
  maxCompletionTicks: number;
  /** Average completion time, rounded to the nearest tick. */
  avgCompletionTicks: number;
  /** Total number of personal bests achieved across the team. */
  personalBests: number;
};

type SimplePersonalBest = {
  type: SplitType;
  ticks: number;
};

export type ChallengePersonalBest = SimplePersonalBest & {
  player: string;
};

export type SessionPlayerStats = {
  username: string;
  deaths: number;
  deathsByStage: Record<Stage, number>;
  personalBests: SimplePersonalBest[];
};

export type SessionChallenge = Omit<ChallengeOverview, 'sessionUuid'> &
  Required<Pick<ChallengeOverview, 'splits'>> & {
    personalBests: ChallengePersonalBest[];
  };

export type SessionWithStats = Omit<Session, 'partyHash'> & {
  challenges: SessionChallenge[];
  party: string[];
  stats: SessionStats;
  playerStats: SessionPlayerStats[];
};

/**
 * Loads detailed statistics for a session.
 *
 * @param uuid The UUID of the session to load.
 * @returns The session.
 */
export async function loadSessionWithStats(
  uuid: string,
): Promise<SessionWithStats | null> {
  let rawSession: postgres.Row;

  try {
    const [result] = await sql`
      SELECT * FROM challenge_sessions
      WHERE uuid = ${uuid}
    `;

    if (result === undefined) {
      return null;
    }

    rawSession = result;
  } catch (e) {
    if (isPostgresInvalidTextRepresentation(e)) {
      return null;
    }
    throw e;
  }

  const rawChallenges = await sql`
    SELECT * FROM challenges
    WHERE session_id = ${rawSession.id}
      AND status != ${ChallengeStatus.ABANDONED}
    ORDER BY start_time ASC
  `;

  if (rawChallenges.length === 0) {
    return null;
  }

  const challengeIds = rawChallenges.map((c) => c.id);
  const extraChallengeData = rawChallenges.reduce<
    Record<
      number,
      Pick<
        SessionChallenge,
        | 'party'
        | 'splits'
        | 'personalBests'
        | 'tobStats'
        | 'mokhaiotlStats'
        | 'infernoStats'
      >
    >
  >((acc, c) => {
    acc[c.id] = {
      party: [],
      splits: {},
      personalBests: [],
    };
    return acc;
  }, {});

  const challengePlayersQuery = sql`
    SELECT
      cp.challenge_id,
      cp.username,
      cp.stage_deaths,
      cp.primary_gear,
      p.username AS current_username
    FROM challenge_players cp
    JOIN players p ON p.id = cp.player_id
    WHERE cp.challenge_id = ANY(${challengeIds})
    ORDER BY cp.orb ASC, cp.challenge_id ASC
  `;

  const challengeSplitsQuery = sql`
    SELECT challenge_id, type, ticks, accurate FROM challenge_splits
    WHERE challenge_id = ANY(${challengeIds})
  `;

  const personalBestsQuery = sql`
    SELECT p.username, cs.challenge_id, cs.type, cs.ticks
    FROM personal_best_history pbh
    JOIN challenge_splits cs ON pbh.challenge_split_id = cs.id
    JOIN players p ON p.id = pbh.player_id
    WHERE cs.challenge_id = ANY(${challengeIds})
      AND cs.type = ANY(${RELEVANT_PB_SPLITS})
    ORDER BY pbh.created_at ASC
  `;

  let challengeStatsQuery: Promise<postgres.Row[]>;
  const statsMeta = statsTableAndField(rawChallenges[0].type as ChallengeType);
  if (statsMeta !== null) {
    challengeStatsQuery = sql`
      SELECT * FROM ${sql(statsMeta.table)}
      WHERE challenge_id = ANY(${challengeIds})
    `;
  } else {
    challengeStatsQuery = Promise.resolve([]);
  }

  const [challengePlayers, challengeSplits, personalBests, challengeStats] =
    await Promise.all([
      challengePlayersQuery,
      challengeSplitsQuery,
      personalBestsQuery,
      challengeStatsQuery,
    ]);

  for (const player of challengePlayers) {
    extraChallengeData[player.challenge_id].party.push({
      username: player.username,
      currentUsername: player.current_username,
      primaryGear: player.primary_gear,
      deaths: player.stage_deaths,
    });
  }

  // Use the first challenge's party as the canonical session party.
  const party = extraChallengeData[rawChallenges[0].id].party.map(
    (p) => p.username,
  );

  for (const split of challengeSplits) {
    extraChallengeData[split.challenge_id].splits[split.type as SplitType] = {
      ticks: split.ticks,
      accurate: split.accurate,
    };
  }

  const pbsByPlayer: Map<string, Map<SplitType, number>> = new Map(
    party.map((p) => [p, new Map()]),
  );

  for (const pb of personalBests) {
    extraChallengeData[pb.challenge_id].personalBests.push({
      player: pb.username,
      type: pb.type as SplitType,
      ticks: pb.ticks,
    });

    // PB rows are sorted by creation date, so the latest row is the fastest.
    pbsByPlayer.get(pb.username)?.set(pb.type as SplitType, pb.ticks);
  }

  for (const stat of challengeStats) {
    const challengeId = stat.challenge_id;
    (extraChallengeData[challengeId] as any)[statsMeta!.field] =
      statsObject(stat);
  }

  const challenges: SessionChallenge[] = rawChallenges.map((c) => ({
    uuid: c.uuid,
    type: c.type as ChallengeType,
    status: c.status as ChallengeStatus,
    mode: c.mode as ChallengeMode,
    stage: c.stage,
    scale: c.scale,
    startTime: c.start_time,
    finishTime: c.finish_time,
    challengeTicks: c.challenge_ticks,
    overallTicks: c.overall_ticks,
    totalDeaths: c.total_deaths,
    ...extraChallengeData[c.id],
  }));

  const statsForPlayer: Record<string, SessionPlayerStats> = {};
  for (const cp of challengePlayers) {
    if (!statsForPlayer[cp.username]) {
      statsForPlayer[cp.username] = {
        username: cp.username,
        deaths: 0,
        deathsByStage: {} as Record<Stage, number>,
        personalBests: Array.from(
          pbsByPlayer.get(cp.username)?.entries() ?? [],
        ).map(([type, ticks]) => ({
          type: type as SplitType,
          ticks,
        })),
      };
    }

    statsForPlayer[cp.username].deaths += cp.stage_deaths.length;
    for (const stage of cp.stage_deaths) {
      if (!statsForPlayer[cp.username].deathsByStage[stage]) {
        statsForPlayer[cp.username].deathsByStage[stage] = 0;
      }
      statsForPlayer[cp.username].deathsByStage[stage]++;
    }
  }

  // The number of challenges in a session will always be reasonable, so stats
  // can be aggregated here rather than in the database.
  const stats: SessionStats = {
    challenges: challenges.length,
    completions: 0,
    wipes: 0,
    resets: 0,
    deaths: 0,
    completionRate: 0,
    minCompletionTicks: Infinity,
    maxCompletionTicks: 0,
    avgCompletionTicks: 0,
    // The number of unique personal bests across the team.
    personalBests: Object.values(statsForPlayer).reduce(
      (acc, player) => acc + player.personalBests.length,
      0,
    ),
  };
  let totalCompletionTicks = 0;

  for (const challenge of challenges) {
    switch (challenge.status) {
      case ChallengeStatus.COMPLETED:
        stats.completions++;

        totalCompletionTicks += challenge.challengeTicks;
        stats.minCompletionTicks = Math.min(
          stats.minCompletionTicks,
          challenge.challengeTicks,
        );
        stats.maxCompletionTicks = Math.max(
          stats.maxCompletionTicks,
          challenge.challengeTicks,
        );
        break;

      case ChallengeStatus.WIPED:
        stats.wipes++;
        break;

      case ChallengeStatus.RESET:
        stats.resets++;
        break;
    }

    stats.deaths += challenge.totalDeaths;
  }

  if (stats.challenges > 0) {
    stats.completionRate = (stats.completions / stats.challenges) * 100;
  }

  if (stats.completions > 0) {
    stats.avgCompletionTicks = Math.round(
      totalCompletionTicks / stats.completions,
    );
  } else {
    stats.minCompletionTicks = 0;
  }

  const session: SessionWithStats = {
    uuid: rawSession.uuid,
    challengeType: rawSession.challenge_type as ChallengeType,
    challengeMode: rawSession.challenge_mode as ChallengeMode,
    scale: rawSession.scale,
    startTime: rawSession.start_time,
    endTime: rawSession.end_time,
    status: rawSession.status as SessionStatus,
    party,
    challenges,
    stats,
    playerStats: party.map((username) => statsForPlayer[username]),
  };

  return session;
}

/**
 * Loads `limit` most recent sessions that match the provided query.
 *
 * @param limit The maximum number of sessions to load.
 * @param query The query to filter sessions by.
 * @returns Sessions matching the query.
 */
export async function loadSessions(
  limit: number = 10,
  query: SessionQuery = {},
): Promise<SessionWithChallenges[]> {
  const { conditions, defaultSort } = sessionFilters(query);

  const sessions = await sql`
    SELECT "challenge_sessions".*
    FROM challenge_sessions
    ${where(conditions)}
    ${order(defaultSort)}
    LIMIT ${limit}
  `;

  if (sessions.length === 0) {
    return [];
  }

  const sessionsByUuid = new Map(
    sessions.map((s) => [
      s.uuid,
      { ...s, challenges: [] as ChallengeOverview[] },
    ]),
  );

  const [challenges] = await findChallenges(null, {
    session: sessions.map((s) => s.id),
  });

  if (challenges.length === 0) {
    console.warn(
      'No challenges found for sessions:',
      sessions.map((s) => s.uuid),
    );
    return [];
  }

  for (const c of challenges) {
    sessionsByUuid.get(c.sessionUuid)?.challenges.push(c);
  }

  return sessions.map((session) => ({
    uuid: session.uuid,
    challengeType: session.challenge_type as ChallengeType,
    challengeMode: session.challenge_mode as ChallengeMode,
    scale: session.scale,
    startTime: session.start_time,
    endTime: session.end_time,
    status: session.status as SessionStatus,
    party:
      sessionsByUuid
        .get(session.uuid)
        ?.challenges[0]?.party.map((p) => p.username) ?? [],
    challenges:
      sessionsByUuid.get(session.uuid)?.challenges.toSorted(
        // Sort challenges by most recent first.
        (a, b) => b.startTime.getTime() - a.startTime.getTime(),
      ) ?? [],
  }));
}

function sessionFieldToExpression(field: string): postgres.Fragment {
  const snakeField = camelToSnake(field);
  switch (snakeField) {
    case 'duration':
      // Time difference in seconds.
      return sql`
        EXTRACT(
          EPOCH FROM (
            COALESCE(challenge_sessions.end_time, NOW()) - challenge_sessions.start_time
          )
        )
      `;

    case 'challenges':
      // Number of challenges in the session.
      return sql`(
        SELECT COUNT(*)
        FROM challenges c
        WHERE c.session_id = challenge_sessions.id
          AND c.status != ${ChallengeStatus.ABANDONED}
      )`;

    default:
      throw new InvalidQueryError(`Invalid aggregation field: ${field}`);
  }
}

function sessionGroupingFieldToDb(field: string): string {
  switch (field) {
    case 'type':
      return 'challenge_type';
    case 'mode':
      return 'challenge_mode';
    case 'party':
      return 'party_hash';
    case 'scale':
      return 'scale';
    case 'status':
      return 'status';
    default:
      throw new InvalidQueryError(`Invalid grouping field: ${field}`);
  }
}

export type SessionAggregationOptions<F extends AggregationQuery = {}> = {
  limit?: number;
  sort?: SortQuery<Aggregation | FieldAggregation<keyof Omit<F, '*'> & string>>;
};

/**
 * Aggregates sessions based on the provided query.
 *
 * @param query The query to filter sessions by.
 * @param fields The fields to aggregate.
 * @returns The aggregated results.
 */
export async function aggregateSessions<F extends AggregationQuery>(
  query: SessionQuery,
  fields: F,
): Promise<AggregationResult<F> | null>;

export async function aggregateSessions<F extends AggregationQuery>(
  query: SessionQuery,
  fields: F,
  options: SessionAggregationOptions<F>,
): Promise<AggregationResult<F> | null>;

export async function aggregateSessions<
  F extends AggregationQuery,
  G extends string | string[],
>(
  query: SessionQuery,
  fields: F,
  options: SessionAggregationOptions<F>,
  grouping: G,
): Promise<GroupedAggregationResult<F, G> | null>;

export async function aggregateSessions<
  F extends AggregationQuery,
  G extends string | string[],
>(
  query: SessionQuery,
  fields: F,
  options: SessionAggregationOptions<F> = { limit: 50 },
  grouping?: G,
): Promise<AggregationResult<F> | GroupedAggregationResult<F, G> | null> {
  const { conditions } = sessionFilters(query);

  const aggregateName = (field: string, agg: Aggregation): string =>
    `${agg}_${field}`;

  const originalFields: Record<string, string> = {};
  let hasCount = false;

  const aggregateFields = Object.entries(fields).flatMap(([field, aggs]) => {
    if (field === '*') {
      if (aggs !== 'count') {
        throw new InvalidQueryError(
          'Cannot aggregate all fields with non-count aggregation',
        );
      }
      hasCount = true;
      return sql`COUNT(*) as count`;
    }

    if (!Array.isArray(aggs)) {
      aggs = [aggs];
    }

    const fieldExpression = sessionFieldToExpression(field);

    return aggs.map((agg) => {
      const name = aggregateName(field, agg);
      originalFields[name] = field;
      return sql`${sql(agg)}(${fieldExpression}) as ${sql(name)}`;
    });
  });

  let groupFields: string[] = [];
  if (grouping !== undefined) {
    const fields = Array.isArray(grouping) ? grouping : [grouping];
    groupFields = (fields as string[]).map(sessionGroupingFieldToDb);
  }

  const floatOrZero = (value: string | number | null | undefined): number => {
    const num = parseFloat(value as string);
    return Number.isNaN(num) ? 0 : num;
  };

  let sort = undefined;
  if (options.sort) {
    const { direction, field } = parseSort(options.sort);
    const [fieldName, agg] = field.split(':');
    if (!(fieldName in fields)) {
      throw new InvalidQueryError(`Invalid aggregation field: ${fieldName}`);
    }

    if (agg === undefined) {
      sort = `${direction}${field}`;
    } else if (isAggregation(agg)) {
      sort = `${direction}${aggregateName(fieldName, agg as Aggregation)}#nl`;
    } else {
      throw new InvalidQueryError(`Invalid aggregation: ${agg}`);
    }
  }

  const rows = await sql`
    SELECT
      ${
        groupFields.length > 0
          ? sql`${groupFields.map(
              (g) => sql`challenge_sessions.${sql(g)} as ${sql(g)},`,
            )}`
          : sql``
      }
      ${aggregateFields.flatMap((f, i) => (i === 0 ? f : [sql`, `, f]))}
    FROM challenge_sessions
    ${where(conditions)}
    ${groupFields.length > 0 ? sql`GROUP BY ${sql(groupFields)}` : sql``}
    ${sort ? order(sort) : sql``}
    ${options.limit ? sql`LIMIT ${options.limit}` : sql``}
  `;

  if (rows.length === 0) {
    if (groupFields.length > 0) {
      return {} as any;
    }
    if (hasCount) {
      return { '*': { count: 0 } } as any;
    }
    return null;
  }

  if (groupFields.length === 0) {
    const result = {} as AggregationResult<any>;
    const row = rows[0];

    Object.entries(row).forEach(([key, value]) => {
      if (key === 'count') {
        result['*'] = { count: parseInt(value as string) };
        return;
      }

      const agg = key.split('_')[0];
      const field = originalFields[key];

      if (result[field] === undefined) {
        result[field] = {};
      }

      result[field][agg as Aggregation] = floatOrZero(value);
    });

    return result;
  }

  const result = {} as Record<string, any>;
  const groupingFieldsRaw = Array.isArray(grouping) ? grouping : [grouping!];

  // If grouping by party, we want to return a list of usernames rather than
  // the hash as the group key. Reconstruct the list from the players in the
  // first challenge of each session that has the party hash.
  const partyHashes = new Map<string, string[]>();

  if (groupingFieldsRaw.includes('party' as G)) {
    const partyField = sessionGroupingFieldToDb('party');
    for (const row of rows) {
      if (row[partyField]) {
        partyHashes.set(row[partyField], []);
      }
    }

    const conditionsWithHash = [
      ...conditions,
      sql`party_hash = ANY(${Array.from(partyHashes.keys())})`,
    ];

    const partyUsernames = await sql`
      WITH latest_sessions AS (
        SELECT DISTINCT ON (party_hash) id, party_hash
        FROM challenge_sessions
        ${where(conditionsWithHash)}
        ORDER BY party_hash, end_time DESC NULLS LAST
      ),
      first_challenges AS (
        SELECT DISTINCT ON (session_id) id, session_id
        FROM challenges
        WHERE session_id IN (SELECT id FROM latest_sessions)
        ORDER BY session_id, start_time
      )
      SELECT
        cs.party_hash,
        p.username
      FROM latest_sessions cs
      JOIN first_challenges fc ON fc.session_id = cs.id
      JOIN challenge_players cp ON cp.challenge_id = fc.id
      JOIN players p ON p.id = cp.player_id
      ORDER BY cs.party_hash, cp.orb;
    `;

    for (const { party_hash, username } of partyUsernames) {
      partyHashes.get(party_hash)?.push(username);
    }
  }

  rows.forEach((row) => {
    let groupResult = {} as any;

    Object.entries(row).forEach(([key, value]) => {
      if (key === 'count') {
        groupResult['*'] = { count: parseInt(value as string) };
        return;
      }

      if (groupFields.includes(key)) {
        return;
      }

      const agg = key.split('_')[0];
      const field = originalFields[key];

      if (groupResult[field] === undefined) {
        groupResult[field] = {};
      }

      groupResult[field][agg as Aggregation] = floatOrZero(value);
    });

    let parent = result;

    groupingFieldsRaw.forEach((field, i) => {
      const dbField = sessionGroupingFieldToDb(field);
      let value = row[dbField];

      if (field === 'party') {
        value = partyHashes.get(value)?.join(',') || value;
      }

      if (i === groupingFieldsRaw.length - 1) {
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
 * @param type Optional event type to filter by.
 * @param attempt If the challenge stage can be attempted multiple times, the
 * attempt number for which to fetch events.
 * @returns Array of events for the stage, or `null` if the stage does not
 * exist.
 * @throws Any error that occurs while fetching the events.
 */
export async function loadEventsForStage(
  challengeId: string,
  stage: Stage,
  type?: EventType,
  attempt?: number,
): Promise<Event[] | null> {
  try {
    const events = await dataRepository.loadStageEvents(
      challengeId,
      stage,
      attempt,
    );
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

export type PlayerWithStats = Pick<Player, 'username' | 'totalRecordings'> & {
  stats: Omit<PlayerStats, 'playerId' | 'date'>;
  firstRecorded: Date;
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

  const [firstStats] = await sql<[{ date: Date }?]>`
    SELECT date
    FROM player_stats
    WHERE player_id = ${playerWithStats.player_id}
    ORDER BY date ASC
    LIMIT 1
  `;
  const firstRecorded = firstStats?.date ?? new Date();

  return {
    username: playerWithStats.username,
    totalRecordings: playerWithStats.total_recordings,
    firstRecorded,
    stats: {
      tobCompletions: playerWithStats.tob_completions,
      tobWipes: playerWithStats.tob_wipes,
      tobResets: playerWithStats.tob_resets,
      colosseumCompletions: playerWithStats.colosseum_completions,
      colosseumWipes: playerWithStats.colosseum_wipes,
      colosseumResets: playerWithStats.colosseum_resets,
      infernoCompletions: playerWithStats.inferno_completions,
      infernoWipes: playerWithStats.inferno_wipes,
      infernoResets: playerWithStats.inferno_resets,
      mokhaiotlCompletions: playerWithStats.mokhaiotl_completions,
      mokhaiotlWipes: playerWithStats.mokhaiotl_wipes,
      mokhaiotlResets: playerWithStats.mokhaiotl_resets,
      mokhaiotlTotalDelves: playerWithStats.mokhaiotl_total_delves,
      mokhaiotlDelvesCompleted: playerWithStats.mokhaiotl_delves_completed,
      mokhaiotlDeepDelvesCompleted:
        playerWithStats.mokhaiotl_deep_delves_completed,
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
  date: Date;
  rank?: SplitRank;
};

export type SplitRank = {
  position: number;
  total: number;
};

type PbsFilter = {
  splits?: SplitType[];
  scales?: number[];
};

export async function loadPbsForPlayer(
  username: string,
  filter?: PbsFilter,
): Promise<PersonalBest[]> {
  const rows = await sql`
    WITH player_id_cte AS (
      SELECT id
      FROM players
      WHERE lower(username) = ${username.toLowerCase()}
      LIMIT 1
    ),
    player_pbs AS (
      SELECT
        cs.type,
        cs.scale,
        cs.ticks,
        c.uuid,
        pbh.created_at as date
      FROM personal_best_history pbh
      JOIN challenge_splits cs ON pbh.challenge_split_id = cs.id
      JOIN challenges c ON cs.challenge_id = c.id
      WHERE pbh.player_id = (SELECT id FROM player_id_cte)
        ${filter?.splits ? sql`AND cs.type = ANY(${filter.splits})` : sql``}
        ${filter?.scales ? sql`AND cs.scale = ANY(${filter.scales})` : sql``}
        AND cs.accurate = true
    ),
    latest_pbs AS (
      SELECT *,
        ROW_NUMBER() OVER (PARTITION BY type, scale ORDER BY date DESC) AS rn
      FROM player_pbs
    )
    SELECT
      uuid as cid,
      date,
      type,
      scale,
      ticks
    FROM latest_pbs
    WHERE rn = 1
  `;

  return rows.map((row) => ({
    cid: row.cid,
    type: row.type,
    scale: row.scale,
    ticks: row.ticks,
    date: row.date,
  }));
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

  const deathsByStage = {} as Record<Stage, number>;

  for (const stage of stages) {
    const field = stageToStatsField(stage);
    if (field !== null) {
      statsFields.push([stage, field]);
    } else {
      otherStages.push(stage);
    }
    deathsByStage[stage] = 0;
  }

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
    // TODO(frolv): The only other challenge recorded currently is Colosseum,
    // which is solo only, so this hack works for now. Eventually, all deaths
    // should be tracked with player stats.
    promises.push(
      await sql`
        SELECT stage, COUNT(*) as deaths
        FROM challenges
        WHERE
          type = ${ChallengeType.COLOSSEUM}
          AND stage = ANY(${otherStages})
          AND status = ${ChallengeStatus.WIPED}
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
 * @param startTime Only return splits from challenges that started after
 *   this time.
 * @returns Object mapping split types to an array of ranked split times.
 */
export async function findBestSplitTimes(
  types: SplitType[],
  scale: number,
  numRanks: number,
  startTime?: Date,
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
          ${startTime ? sql`AND challenges.start_time >= ${startTime}` : sql``}
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

export type PlayerStatsFilter = {
  after?: Date;
  before?: Date;
  fields?: string[];
};

/**
 * Fetches historical stats for a player with optional filtering.
 * @param username The player's username.
 * @param filter Optional filters to apply to the query.
 * @returns Array of stats entries, ordered by date descending.
 */
export async function getPlayerStatsHistory(
  username: string,
  limit?: number,
  filter: PlayerStatsFilter = {},
): Promise<Partial<PlayerStats>[]> {
  const conditions: postgres.Fragment[] = [
    sql`lower(players.username) = ${username.toLowerCase()}`,
  ];
  const fields: postgres.Fragment[] = [];

  if (filter.after) {
    conditions.push(sql`player_stats.date >= ${filter.after}`);
  }
  if (filter.before) {
    conditions.push(sql`player_stats.date < ${filter.before}`);
  }

  if (filter.fields && filter.fields.length > 0) {
    fields.push(sql`player_stats.date`);
    for (const field of filter.fields) {
      if (field === 'id' || field === 'player_id') {
        throw new InvalidQueryError(`Invalid field: ${snakeToCamel(field)}`);
      }
      fields.push(sql`player_stats.${sql(camelToSnake(field))}`);
    }
  }

  try {
    const rows = await sql`
      SELECT ${
        fields.length > 0
          ? sql`${fields.flatMap((f, i) => (i === 0 ? f : [sql`, `, f]))}`
          : sql`player_stats.*`
      }
    FROM players
    JOIN player_stats ON players.id = player_stats.player_id
    ${where(conditions)}
    ORDER BY player_stats.date DESC
    ${limit ? sql`LIMIT ${limit}` : sql``}
  `;

    return rows.map((row) => {
      const { date, player_id, id, ...statsFields } = row;
      const stats: Partial<PlayerStats> = { date };

      for (const [key, value] of Object.entries(statsFields)) {
        stats[snakeToCamel(key) as keyof PlayerStats] = value;
      }

      return stats;
    });
  } catch (e: any) {
    if (isPostgresUndefinedColumn(e)) {
      const missingField = /column ([^"]+) does not exist/.exec(e.message);
      if (missingField) {
        let field = missingField[1];
        if (field.startsWith('player_stats.')) {
          field = field.slice(13);
        }
        throw new InvalidQueryError(`Invalid field: ${snakeToCamel(field)}`);
      }
      throw new InvalidQueryError('Invalid field');
    }
    throw e;
  }
}

export type PlayerNetworkOptions = {
  limit?: number;
  type?: ChallengeType;
  mode?: ChallengeMode;
  scale?: number[];
  from?: Date;
  to?: Date;
  minChallengesTogether?: number;
};

/**
 * Loads the player network for a given set of filters. The network is
 * represented as a graph with players as nodes and edges representing the
 * number of challenges they have completed together.
 *
 * @param options Options for filtering the network.
 * @returns The player network.
 */
export async function loadPlayerNetwork(options: PlayerNetworkOptions) {
  const {
    limit = 10_000,
    type,
    mode,
    scale,
    from,
    to,
    minChallengesTogether = 5,
  } = options;

  const conditions: postgres.Fragment[] = [];
  if (type) {
    conditions.push(sql`challenge_type = ${type}`);
  }
  if (mode) {
    conditions.push(sql`challenge_mode = ${mode}`);
  }
  if (scale) {
    conditions.push(sql`challenge_scale = ANY(${scale})`);
  }
  if (from) {
    conditions.push(sql`day_bucket >= ${from}`);
  }
  if (to) {
    conditions.push(sql`day_bucket <= ${to}`);
  }

  const edges = await sql`
    SELECT player_id_1, player_id_2, SUM(challenge_count) as challenge_count
    FROM mv_daily_player_pairs
    ${where(conditions)}
    GROUP BY player_id_1, player_id_2
    HAVING SUM(challenge_count) >= ${minChallengesTogether}
    ORDER BY challenge_count DESC
    LIMIT ${limit}
  `;

  const playerIds = Array.from(
    new Set(edges.flatMap((e) => [e.player_id_1, e.player_id_2])),
  );
  const players = await sql<{ id: number; username: string }[]>`
    SELECT id, username FROM players WHERE id = ANY(${playerIds})
  `;

  const playerMap = new Map(players.map((p) => [p.id, p.username]));
  const nodes = Array.from(playerMap.entries()).map(
    ([_, username]) => username,
  );

  return {
    nodes,
    edges: edges.map((e) => ({
      source: playerMap.get(e.player_id_1) ?? 'Unknown',
      target: playerMap.get(e.player_id_2) ?? 'Unknown',
      value: parseInt(e.challenge_count),
    })),
    meta: {
      filters: { type, mode, scale, from, to },
    },
  };
}

export type ChallengePartner = {
  username: string;
  challengesTogether: number;
  firstChallengeDate: Date;
  lastChallengeDate: Date;
};

/**
 * Returns the top partners for a player, based on the number of challenges
 * they have completed together.
 *
 * @param username The player's username.
 * @param options Optional options to filter the results.
 * @returns Array of partner objects, ordered by number of challenges together
 *   in descending order. If no player with the given username exists, returns
 *   `null`.
 */
export async function topPartnersForPlayer(
  username: string,
  options: PlayerNetworkOptions,
): Promise<ChallengePartner[] | null> {
  const {
    limit = 10,
    type,
    mode,
    scale,
    from,
    to,
    minChallengesTogether = 1,
  } = options;

  const playerId = await sql<{ id: number }[]>`
    SELECT id FROM players WHERE LOWER(username) = ${username.toLowerCase()}
  `.then((rows) => rows[0]?.id);

  if (!playerId) {
    return null;
  }

  const rows = await sql`
    SELECT
      CASE WHEN player_id_1 = ${playerId} THEN player_id_2 ELSE player_id_1 END AS partner_id,
      SUM(challenge_count) AS challenges_together,
      MIN(day_bucket) AS first_challenge_date,
      MAX(day_bucket) AS last_challenge_date
    FROM mv_daily_player_pairs
    WHERE
      (${playerId} IN (player_id_1, player_id_2))
      ${type ? sql`AND challenge_type = ${type}` : sql``}
      ${mode ? sql`AND challenge_mode = ${mode}` : sql``}
      ${scale ? sql`AND challenge_scale = ANY(${scale})` : sql``}
      ${from ? sql`AND day_bucket >= ${from}` : sql``}
      ${to ? sql`AND day_bucket <= ${to}` : sql``}
    GROUP BY partner_id
    HAVING SUM(challenge_count) >= ${minChallengesTogether}
    ORDER BY challenges_together DESC
    LIMIT ${limit}
  `;

  if (rows.length === 0) {
    return [];
  }

  const partnerIds = rows.map((row) => row.partner_id);
  const partnerRows = await sql<{ id: number; username: string }[]>`
    SELECT id, username FROM players WHERE id = ANY(${partnerIds})
  `;

  const partnerNames = new Map<number, string>(
    partnerRows.map((row) => [row.id, row.username]),
  );

  return rows.map((row) => ({
    username: partnerNames.get(row.partner_id) ?? 'Unknown',
    challengesTogether: parseInt(row.challenges_together),
    firstChallengeDate: row.first_challenge_date,
    lastChallengeDate: row.last_challenge_date,
  }));
}

export type BloatHandsView = 'total' | 'wave' | 'chunk' | 'intraChunkOrder';

export type BloatHandsQuery = ChallengeQuery & {
  wave?: Comparator<number>;
  chunk?: Comparator<number>;
  intraChunkOrder?: Comparator<number>;
};

export type BloatHandsResponse = {
  totalChallenges: number;
  totalHands: number;
  data: BloatHandsData;
};

export type BloatHandsData =
  | { view: 'total'; byTile: Record<string, number> }
  | { view: 'wave'; byWave: Record<string, Record<string, number>> }
  | { view: 'chunk'; byChunk: Record<string, number> }
  | {
      view: 'intraChunkOrder';
      byOrder: Record<string, Record<string, number>>;
    };

/**
 * Aggregates bloat hand spawn data from multiple challenges.
 *
 * @param query Challenge query with bloat-specific filters
 * @param view The aggregation view mode
 * @returns Aggregated bloat hands data or null if no challenges match
 */
export async function aggregateBloatHands(
  query: BloatHandsQuery,
  view: BloatHandsView,
): Promise<BloatHandsResponse | null> {
  const components = applyFilters(query, [], false, false);
  if (components === null) {
    return null;
  }

  const { baseTable, queryTable, joins, conditions } = components;

  joins.push({
    table: sql`bloat_hands`,
    on: sql`${queryTable}.id = bloat_hands.challenge_id`,
    tableName: 'bloat_hands',
  });

  if (query.wave !== undefined) {
    conditions.push(
      comparatorToSql(sql('bloat_hands'), 'wave_number', query.wave),
    );
  }
  if (query.chunk !== undefined) {
    conditions.push(comparatorToSql(sql('bloat_hands'), 'chunk', query.chunk));
  }
  if (query.intraChunkOrder !== undefined) {
    conditions.push(
      comparatorToSql(
        sql('bloat_hands'),
        'intra_chunk_order',
        query.intraChunkOrder,
      ),
    );
  }

  if (view !== 'chunk') {
    conditions.push(sql`bloat_hands.tile_id IS NOT NULL`);
  }

  const totals = await sql`
    SELECT
      COUNT(DISTINCT ${queryTable}.id) as total_challenges,
      COUNT(*) as total_hands
    FROM ${baseTable}
    ${join(joins)}
    ${where(conditions)}
  `;

  const totalChallenges = parseInt(totals[0]?.total_challenges ?? '0');
  const totalHands = parseInt(totals[0]?.total_hands ?? '0');
  let data: BloatHandsData;

  switch (view) {
    case 'total':
      data = await aggregateByTile(baseTable, joins, conditions);
      break;
    case 'wave':
      data = await aggregateByWave(baseTable, joins, conditions);
      break;
    case 'chunk':
      data = await aggregateByChunk(baseTable, joins, conditions);
      break;
    case 'intraChunkOrder':
      data = await aggregateByIntraChunkOrder(baseTable, joins, conditions);
      break;
  }

  return {
    totalChallenges,
    totalHands,
    data,
  };
}

async function aggregateByTile(
  baseTable: postgres.Fragment,
  joins: Join[],
  conditions: postgres.Fragment[],
): Promise<BloatHandsData> {
  const rows = await sql`
    SELECT
      bloat_hands.tile_id,
      COUNT(*) as hand_count
    FROM ${baseTable}
    ${join(joins)}
    ${where(conditions)}
    GROUP BY bloat_hands.tile_id
    ORDER BY bloat_hands.tile_id
  `;

  return {
    view: 'total',
    byTile: Object.fromEntries(
      rows.map((row) => [row.tile_id.toString(), parseInt(row.hand_count)]),
    ),
  };
}

async function aggregateByWave(
  baseTable: postgres.Fragment,
  joins: Join[],
  conditions: postgres.Fragment[],
): Promise<BloatHandsData> {
  const rows = await sql`
    SELECT
      bloat_hands.wave_number,
      bloat_hands.tile_id,
      COUNT(*) as hand_count
    FROM ${baseTable}
    ${join(joins)}
    ${where(conditions)}
    GROUP BY bloat_hands.wave_number, bloat_hands.tile_id
    ORDER BY bloat_hands.wave_number, bloat_hands.tile_id
  `;

  const byWave: Record<string, Record<string, number>> = {};
  rows.forEach((row) => {
    const wave = row.wave_number.toString();
    const tile = row.tile_id.toString();

    if (!byWave[wave]) {
      byWave[wave] = {};
    }
    byWave[wave][tile] = parseInt(row.hand_count);
  });

  return { view: 'wave', byWave };
}

async function aggregateByChunk(
  baseTable: postgres.Fragment,
  joins: Join[],
  conditions: postgres.Fragment[],
): Promise<BloatHandsData> {
  const rows = await sql`
    SELECT
      bloat_hands.chunk,
      COUNT(*) as hand_count
    FROM ${baseTable}
    ${join(joins)}
    ${where(conditions)}
    GROUP BY bloat_hands.chunk
    ORDER BY bloat_hands.chunk
  `;

  return {
    view: 'chunk',
    byChunk: Object.fromEntries(
      rows.map((row) => [row.chunk.toString(), parseInt(row.hand_count)]),
    ),
  };
}

async function aggregateByIntraChunkOrder(
  baseTable: postgres.Fragment,
  joins: Join[],
  conditions: postgres.Fragment[],
): Promise<BloatHandsData> {
  const rows = await sql`
    SELECT
      bloat_hands.intra_chunk_order,
      bloat_hands.tile_id,
      COUNT(*) as hand_count
    FROM ${baseTable}
    ${join(joins)}
    ${where(conditions)}
    GROUP BY bloat_hands.intra_chunk_order, bloat_hands.tile_id
    ORDER BY bloat_hands.intra_chunk_order, bloat_hands.tile_id
  `;

  const byOrder: Record<string, Record<string, number>> = {};
  rows.forEach((row) => {
    const order = row.intra_chunk_order.toString();
    const tile = row.tile_id.toString();

    if (!byOrder[order]) {
      byOrder[order] = {};
    }
    byOrder[order][tile] = parseInt(row.hand_count);
  });

  return { view: 'intraChunkOrder', byOrder };
}
