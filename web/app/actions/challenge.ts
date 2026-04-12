'use server';

import {
  BloatDown,
  CamelToSnakeCase,
  Challenge,
  ChallengeMode,
  ChallengePlayer,
  ChallengeStatus,
  ChallengeType,
  ColosseumChallenge,
  DataRepository,
  Event,
  EventType,
  protoToJsonEvent,
  InfernoChallenge,
  InfernoChallengeStats,
  MokhaiotlChallenge,
  MokhaiotlChallengeStats,
  Player,
  PlayerStats,
  PrimaryMeleeGear,
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
  normalizeRsn,
  snakeToCamel,
  snakeToCamelObject,
} from '@blert/common';
// TODO(frolv): Typescript doesn't like the re-export from common/db so we have
// to import it directly.
import type { ChallengeRow, SessionRow } from '@blert/common/dist/db/challenge';
import postgres from 'postgres';

import logger from '@/utils/log';

import { sql } from './db';
import dataRepository from './data-repository';
import { InvalidQueryError } from './errors';
import {
  BaseOperand,
  Comparator,
  comparatorToSql,
  Condition,
  Join,
  join,
  operator,
  where,
} from './query';

type ChallengeRowWithSessionUuid = ChallengeRow & { session_uuid: string };

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
  const [rawChallenge] = await sql<[ChallengeRowWithSessionUuid?]>`
    SELECT
      challenges.*,
      challenge_sessions.uuid as session_uuid
    FROM challenges
    JOIN challenge_sessions ON challenges.session_id = challenge_sessions.id
    WHERE challenges.uuid = ${id} AND challenges.type = ${type}
  `;
  if (!rawChallenge) {
    return null;
  }

  const playersQuery = sql<
    {
      username: string;
      primary_gear: PrimaryMeleeGear;
      stage_deaths: Stage[];
      current_username: string;
    }[]
  >`
    SELECT
      challenge_players.username,
      challenge_players.primary_gear,
      challenge_players.stage_deaths,
      players.username as current_username
    FROM
      challenge_players JOIN players ON challenge_players.player_id = players.id
    WHERE challenge_id = ${rawChallenge.id}
    ORDER BY orb
  `;

  const splitsQuery = sql<{ type: SplitType; ticks: number }[]>`
    SELECT type, ticks
    FROM challenge_splits
    WHERE challenge_id = ${rawChallenge.id}
  `;

  const [players, splits] = await Promise.all([playersQuery, splitsQuery]);

  const splitsMap: Partial<Record<SplitType, number>> = {};
  splits.forEach((split) => {
    splitsMap[generalizeSplit(split.type)] = split.ticks;
  });

  const challenge: Challenge = {
    uuid: rawChallenge.uuid,
    sessionUuid: rawChallenge.session_uuid,
    type: rawChallenge.type,
    stage: rawChallenge.stage,
    startTime: rawChallenge.start_time,
    finishTime: rawChallenge.finish_time,
    status: rawChallenge.status,
    mode: rawChallenge.mode,
    scale: rawChallenge.scale,
    challengeTicks: rawChallenge.challenge_ticks,
    overallTicks: rawChallenge.overall_ticks,
    totalDeaths: rawChallenge.total_deaths,
    party: players.map((p) => ({
      username: p.username,
      currentUsername: p.current_username,
      primaryGear: p.primary_gear,
      deaths: p.stage_deaths,
    })),
    splits: splitsMap,
  };

  switch (rawChallenge.type) {
    case ChallengeType.TOB: {
      const raid = challenge as TobRaid;

      await Promise.all([
        dataRepository.loadTobChallengeData(id),
        sql`
          SELECT *
          FROM tob_challenge_stats
          WHERE challenge_id = ${rawChallenge.id}
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
          WHERE challenge_id = ${rawChallenge.id}
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
          WHERE challenge_id = ${rawChallenge.id}
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

type StatsObject =
  | TobChallengeStats
  | MokhaiotlChallengeStats
  | InfernoChallengeStats;

function statsObject<T extends StatsObject>(rawRow: Record<string, any>): T {
  delete rawRow.id;
  delete rawRow.challenge_id;
  return snakeToCamelObject(rawRow) as T;
}

type StatsTarget = {
  tobStats?: TobChallengeStats;
  mokhaiotlStats?: MokhaiotlChallengeStats;
  infernoStats?: InfernoChallengeStats;
};

type StatsLoadEntry<T extends StatsTarget> = {
  id: number;
  type: ChallengeType;
  target: T;
};

/**
 * Loads per-challenge stats rows for a heterogeneous set of challenges and
 * attaches them to each entry's `target`.
 */
async function attachChallengeStats<T extends StatsTarget>(
  entries: StatsLoadEntry<T>[],
): Promise<void> {
  const targetsById = new Map<number, T>();
  const idsByType = new Map<ChallengeType, number[]>();
  for (const entry of entries) {
    const id = Number(entry.id);
    targetsById.set(id, entry.target);
    const list = idsByType.get(entry.type) ?? [];
    list.push(id);
    idsByType.set(entry.type, list);
  }

  const promises: Promise<void>[] = [];

  const tobIds = idsByType.get(ChallengeType.TOB);
  if (tobIds !== undefined && tobIds.length > 0) {
    promises.push(
      (async () => {
        const [statsRows, downsRows] = await Promise.all([
          sql<(StatsObject & { challenge_id: number })[]>`
            SELECT * FROM tob_challenge_stats
            WHERE challenge_id = ANY(${tobIds})
          `,
          sql<
            {
              challenge_id: number;
              down_number: number;
              down_tick: number;
              walk_ticks: number;
              accurate: boolean;
            }[]
          >`
            SELECT challenge_id, down_number, down_tick, walk_ticks, accurate
            FROM bloat_downs
            WHERE challenge_id = ANY(${tobIds})
            ORDER BY challenge_id, down_number
          `,
        ]);

        const downsByChallenge = new Map<number, BloatDown[]>();
        for (const row of downsRows) {
          const cid = Number(row.challenge_id);
          let list = downsByChallenge.get(cid);
          if (list === undefined) {
            list = [];
            downsByChallenge.set(cid, list);
          }
          list.push({
            downNumber: row.down_number,
            downTick: row.down_tick,
            walkTicks: row.walk_ticks,
            accurate: row.accurate,
          });
        }

        for (const row of statsRows) {
          const challengeId = Number(
            (row as { challenge_id: number }).challenge_id,
          );
          const target = targetsById.get(challengeId);
          if (target === undefined) {
            continue;
          }
          const tobStats = statsObject<TobChallengeStats>(row);
          tobStats.downs = downsByChallenge.get(challengeId) ?? [];
          target.tobStats = tobStats;
        }
      })(),
    );
  }

  const mokhaiotlIds = idsByType.get(ChallengeType.MOKHAIOTL);
  if (mokhaiotlIds !== undefined && mokhaiotlIds.length > 0) {
    promises.push(
      sql<(StatsObject & { challenge_id: number })[]>`
        SELECT * FROM mokhaiotl_challenge_stats
        WHERE challenge_id = ANY(${mokhaiotlIds})
      `.then((rows) => {
        for (const row of rows) {
          const challengeId = (row as { challenge_id: number }).challenge_id;
          const target = targetsById.get(challengeId);
          if (target === undefined) {
            continue;
          }
          target.mokhaiotlStats = statsObject<MokhaiotlChallengeStats>(row);
        }
      }),
    );
  }

  const infernoIds = idsByType.get(ChallengeType.INFERNO);
  if (infernoIds !== undefined && infernoIds.length > 0) {
    promises.push(
      sql<(StatsObject & { challenge_id: number })[]>`
        SELECT * FROM inferno_challenge_stats
        WHERE challenge_id = ANY(${infernoIds})
      `.then((rows) => {
        for (const row of rows) {
          const challengeId = (row as { challenge_id: number }).challenge_id;
          const target = targetsById.get(challengeId);
          if (target === undefined) {
            continue;
          }
          target.infernoStats = statsObject<InfernoChallengeStats>(row);
        }
      }),
    );
  }

  await Promise.all(promises);
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

export type TobQuery = {
  bloatDowns?: Map<number, Comparator<number>>;
  bloatDownCount?: Comparator<number>;
  nylocasPreCapStalls?: Comparator<number>;
  nylocasPostCapStalls?: Comparator<number>;
  verzikRedsCount?: Comparator<number>;
};

export type ChallengeQuery = {
  uuid?: string[];
  session?: number[] | string[];
  type?: Comparator<ChallengeType>;
  mode?: SingleOrArray<ChallengeMode>;
  status?: Comparator<ChallengeStatus>;
  scale?: Comparator<number>;
  party?: string[];
  /** Whether all players must be present ('all') or any player ('any'). Default: 'all' */
  partyMatch?: 'all' | 'any';
  splits?: Map<SplitType, Comparator<number>>;
  tob?: TobQuery;
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
    const { direction, field: camelField, options } = parseSort(sort);
    const field = camelToSnake(camelField);
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

function applyTobFilters(
  tob: TobQuery,
  baseTable: postgres.Helper<string>,
  joins: Join[],
  conditions: postgres.Fragment[],
) {
  const { bloatDowns, ...statsFilters } = tob;

  if (bloatDowns !== undefined && bloatDowns.size > 0) {
    for (const [downNumber, comparator] of bloatDowns) {
      const condition = comparatorToSql(
        sql('bloat_downs'),
        'walk_ticks',
        comparator,
      );
      conditions.push(
        sql`EXISTS (
          SELECT 1 FROM bloat_downs
          WHERE bloat_downs.challenge_id = ${baseTable}.id
          AND bloat_downs.down_number = ${downNumber}
          AND ${condition}
          AND bloat_downs.accurate
        )`,
      );
    }
  }

  const statsColumns: Record<keyof typeof statsFilters, string> = {
    bloatDownCount: 'bloat_down_count',
    nylocasPreCapStalls: 'nylocas_pre_cap_stalls',
    nylocasPostCapStalls: 'nylocas_post_cap_stalls',
    verzikRedsCount: 'verzik_reds_count',
  };

  let statsJoined = false;
  for (const [field, column] of Object.entries(statsColumns) as [
    keyof typeof statsFilters,
    string,
  ][]) {
    const comparator = statsFilters[field];
    if (comparator === undefined) {
      continue;
    }
    if (!statsJoined) {
      joins.push({
        table: sql`tob_challenge_stats`,
        on: sql`${baseTable}.id = tob_challenge_stats.challenge_id`,
        tableName: 'tob_challenge_stats',
      });
      statsJoined = true;
    }
    conditions.push(
      comparatorToSql(sql('tob_challenge_stats'), column, comparator),
    );
  }
}

function addSplitsTable(
  split: SplitType,
  baseTable: postgres.Helper<string, string[]>,
  joins: Join[],
  conditions: postgres.Fragment[],
  accurateSplits?: boolean,
) {
  const table = splitsTableName(split);
  const types = allSplitModes(generalizeSplit(split));
  joins.push({
    table: sql`challenge_splits ${sql(table)}`,
    on: sql`${baseTable}.id = ${sql(table)}.challenge_id
        AND ${sql(table)}.type = ANY(${types})`,
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
      conditions.push(
        sql`EXISTS (
          SELECT 1 FROM challenge_players
          JOIN players ON challenge_players.player_id = players.id
          WHERE challenge_players.challenge_id = challenges.id
          AND players.normalized_username = ${normalizeRsn(username)}
        )`,
      );
    } else {
      const matchAll = query.partyMatch !== 'any';
      if (matchAll) {
        baseTable = sql`(
          SELECT challenges.*
          FROM challenges
          JOIN challenge_players ON challenges.id = challenge_players.challenge_id
          JOIN players ON challenge_players.player_id = players.id
          WHERE players.normalized_username = ANY(${query.party.map(normalizeRsn)})
          GROUP BY challenges.id
          HAVING COUNT(*) = ${query.party.length}
        ) challenges`;
      } else {
        baseTable = sql`(
          SELECT DISTINCT challenges.*
          FROM challenges
          JOIN challenge_players ON challenges.id = challenge_players.challenge_id
          JOIN players ON challenge_players.player_id = players.id
          WHERE players.normalized_username = ANY(${query.party.map(normalizeRsn)})
        ) challenges`;
      }
    }
  }

  const sqlChallenges = sql('challenges');

  if (query.splits !== undefined && query.splits.size > 0) {
    for (const [type, comparator] of query.splits) {
      const types = allSplitModes(generalizeSplit(type));
      const condition = comparatorToSql(
        sql('challenge_splits'),
        'ticks',
        comparator,
      );
      conditions.push(
        sql`EXISTS (
          SELECT 1 FROM challenge_splits
          WHERE challenge_splits.challenge_id = ${sqlChallenges}.id
          AND challenge_splits.type = ANY(${types})
          AND ${condition}
          AND challenge_splits.accurate
        )`,
      );
    }
  }

  if (query.tob !== undefined) {
    applyTobFilters(query.tob, sqlChallenges, joins, conditions);
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
    sql<ChallengeRowWithSessionUuid[]>`
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
      sql<[{ count: string }]>`
        SELECT COUNT(*)
        FROM ${baseTable}
        ${join(joins)}
        ${where(conditions)}
      `.then(([row]) => {
        total = parseInt(row.count);
      }),
    );
  }

  const rawChallenges = (
    await Promise.all(promises)
  )[0] as ChallengeRowWithSessionUuid[];

  const challengeIds = rawChallenges.map((c) => c.id);
  const extra: Record<number, Partial<ChallengeOverview>> = {};
  for (const id of challengeIds) {
    extra[id] = {};
  }

  const loadPromises: Promise<any>[] = [];

  if (options.extraFields?.splits) {
    const splits = options.extraFields.splits.flatMap(allSplitModes);

    loadPromises.push(
      sql<
        {
          challenge_id: number;
          type: SplitType;
          ticks: number;
          accurate: boolean;
        }[]
      >`
        SELECT challenge_id, type, ticks, accurate
        FROM challenge_splits
        WHERE challenge_id = ANY(${challengeIds}) AND type = ANY(${splits})
      `.then((ss) => {
        ss.forEach((s) => {
          extra[s.challenge_id].splits ??= {};
          const generalized = generalizeSplit(s.type);
          extra[s.challenge_id].splits![generalized] = {
            ticks: s.ticks,
            accurate: s.accurate,
          };
        });
      }),
    );
  }

  if (options.extraFields?.stats) {
    loadPromises.push(
      attachChallengeStats(
        rawChallenges.map((c) => ({
          id: c.id,
          type: c.type,
          target: extra[c.id],
        })),
      ),
    );
  }

  loadPromises.push(
    sql<
      {
        challenge_id: number;
        username: string;
        stage_deaths: Stage[];
        current_username: string;
        primary_gear: PrimaryMeleeGear;
        orb: number;
      }[]
    >`
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
      players.forEach((p) => {
        extra[p.challenge_id].party ??= [];
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
    (c): ChallengeOverview => ({
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

  return [challenges, total];
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
  ? Record<As, number>
  : As extends Aggregation[]
    ? Record<As[number], number>
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

    const invalidAggregations = aggs.filter((agg) => !isAggregation(agg));
    if (invalidAggregations.length > 0) {
      throw new InvalidQueryError(
        `Invalid aggregations: ${invalidAggregations.join(', ')}`,
      );
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

  const groupFields: GroupField[] = [];

  if (grouping !== undefined) {
    const fields: string[] = Array.isArray(grouping) ? grouping : [grouping];
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
      return {} as GroupedAggregationResult<F, G>;
    }
    if (hasCount) {
      return { '*': { count: 0 } } as AggregationResult<F>;
    }
    return null;
  }

  if (groupFields.length === 0) {
    const result = {} as AggregationResult<AggregationQuery>;

    const row = rows[0];

    Object.entries(row).forEach(([key, value]) => {
      if (key === 'count') {
        result['*'] = { count: parseInt(value as string) };
        return;
      }

      const agg = key.split('_')[0] as Aggregation;
      const field = originalFields[key];

      result[field] ??= {} as Record<Aggregation, number>;
      (result[field] as Record<Aggregation, number>)[agg] = floatOrZero(
        value as string,
      );
    });

    return result as AggregationResult<F>;
  }

  const result = {} as GroupedAggregationResult<AggregationQuery, string>;

  rows.forEach((row) => {
    const groupResult = {} as AggregationResult<AggregationQuery>;

    Object.entries(row).forEach(([key, value]) => {
      if (key === 'count') {
        groupResult['*'] = { count: parseInt(value as string) };
        return;
      }

      if (groupFields.some((g) => g.renamed === key)) {
        return;
      }

      const agg = key.split('_')[0];
      const field = originalFields[key];

      groupResult[field] ??= {} as Record<Aggregation, number>;
      (groupResult[field] as Record<string, number>)[agg] = floatOrZero(
        value as string,
      );
    });

    let parent = result;

    groupFields.forEach((field, i) => {
      let value = row[field.renamed] as string | number | Date;
      if (value instanceof Date) {
        const date = value;
        value =
          `${date.getUTCFullYear()}-` +
          `${(date.getUTCMonth() + 1).toString().padStart(2, '0')}-` +
          `${date.getUTCDate().toString().padStart(2, '0')}`;
      }

      if (i === groupFields.length - 1) {
        parent[value] = groupResult;
      } else {
        parent[value] ??= {};
      }

      parent = parent[value] as unknown as GroupedAggregationResult<
        AggregationQuery,
        string
      >;
    });
  });

  return result as GroupedAggregationResult<F, G>;
}

/**
 * Counts the number of distinct players that participated in any challenge
 * matching the given query.
 */
export async function countUniquePlayers(
  query: ChallengeQuery,
): Promise<number> {
  const components = applyFilters(query);
  if (components === null) {
    return 0;
  }

  const { baseTable, joins, conditions } = components;

  // Use a dedicated alias so the count isn't restricted by a party filter's
  // challenge_players join.
  const allJoins: Join[] = [
    ...joins,
    {
      table: sql`challenge_players cp_count`,
      on: sql`challenges.id = cp_count.challenge_id`,
      tableName: 'cp_count',
    },
  ];

  const [row] = await sql<[{ count: string }]>`
    SELECT COUNT(DISTINCT cp_count.player_id) AS count
    FROM ${baseTable}
    ${join(allJoins)}
    ${where(conditions)}
  `;

  return parseInt(row.count);
}

export type SessionQuery = {
  type?: Comparator<ChallengeType>;
  mode?: SingleOrArray<ChallengeMode>;
  scale?: Comparator<number>;
  startTime?: Comparator<Date>;
  status?: Comparator<SessionStatus>;
  party?: string[];
  challengeCount?: Comparator<number>;

  /**
   * Session duration in seconds. Only completed sessions have a finalized
   * duration, so active sessions are excluded.
   */
  duration?: Comparator<number>;

  before?: number[];
  after?: number[];
};

type SessionSortableFields = Pick<Session, 'startTime' | 'endTime' | 'status'>;

export type SessionWithChallenges = Omit<Session, 'partyHash'> & {
  party: string[];
  challenges: ChallengeOverview[];
};

type SessionSortField = 'status' | 'startTime';

type SessionSort = {
  field: SessionSortField;
  direction: SortDirection;
};

function sessionSorts(query: SessionQuery): SessionSort[] {
  if (query.status === undefined) {
    return [
      { field: 'status', direction: '+' },
      { field: 'startTime', direction: '-' },
    ];
  }

  return [{ field: 'startTime', direction: '-' }];
}

function reverseSessionSorts(sorts: SessionSort[]): SessionSort[] {
  return sorts.map((sort) => ({
    ...sort,
    direction: sort.direction === '+' ? '-' : '+',
  }));
}

function sessionSortToQuery(
  sort: SessionSort,
): SortQuery<SessionSortableFields> {
  return `${sort.direction}${sort.field}` as SortQuery<SessionSortableFields>;
}

function sessionSortFieldToColumn(field: SessionSortField): string {
  switch (field) {
    case 'status':
      return 'status';
    case 'startTime':
      return 'start_time';
  }
}

function sessionPaginationCondition(
  sorts: SessionSort[],
  values: number[],
): postgres.Fragment {
  if (sorts.length !== values.length) {
    throw new InvalidQueryError('Invalid session cursor values');
  }

  const [sort, ...restSorts] = sorts;
  const [value, ...restValues] = values;

  const op = sort.direction === '+' ? sql`>` : sql`<`;
  const column = sessionSortFieldToColumn(sort.field);
  const field = sql`challenge_sessions.${sql(column)}`;
  const comparatorValue = sort.field === 'startTime' ? new Date(value) : value;

  if (restSorts.length === 0) {
    return sql`${field} ${op} ${comparatorValue}`;
  }

  const restCondition = sessionPaginationCondition(restSorts, restValues);
  return sql`(${field} ${op} ${comparatorValue} OR (${field} = ${comparatorValue} AND ${restCondition}))`;
}

function sessionFilters(query: SessionQuery): {
  conditions: postgres.Fragment[];
  defaultSort: SingleOrArray<SortQuery<SessionSortableFields>>;
} {
  const conditions: postgres.Fragment[] = [];
  let sorts = sessionSorts(query);

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
  }

  if (query.before !== undefined && query.after !== undefined) {
    throw new InvalidQueryError('Cannot specify both before and after');
  }

  const cursor = query.before ?? query.after;
  if (cursor !== undefined) {
    if (query.before !== undefined) {
      sorts = reverseSessionSorts(sorts);
    }
    conditions.push(sessionPaginationCondition(sorts, cursor));
  }

  const sortQueries = sorts.map(sessionSortToQuery);
  const defaultSort = sortQueries.length === 1 ? sortQueries[0] : sortQueries;

  if (query.party) {
    if (query.party.length === 1) {
      conditions.push(
        sql`
          challenge_sessions.id IN (
            SELECT DISTINCT(c.session_id)
            FROM challenge_players cp
            JOIN players p ON p.id = cp.player_id
            JOIN challenges c ON c.id = cp.challenge_id
            WHERE p.normalized_username = ${normalizeRsn(query.party[0])}
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
            WHERE p.normalized_username = ANY(${query.party.map(normalizeRsn)})
            GROUP BY c.id
            HAVING COUNT(*) = ${query.party.length}
          )
        `,
      );
    }
  }

  if (query.challengeCount !== undefined) {
    const having = comparatorToSql(sql`COUNT(*)`, query.challengeCount);
    conditions.push(
      sql`
        challenge_sessions.id IN (
          SELECT c.session_id
          FROM challenges c
          WHERE c.status != ${ChallengeStatus.ABANDONED}
          GROUP BY c.session_id
          HAVING ${having}
        )
      `,
    );
  }

  if (query.duration !== undefined) {
    conditions.push(sql`challenge_sessions.end_time IS NOT NULL`);
    const durationExpr = sql`
      EXTRACT(EPOCH FROM (challenge_sessions.end_time - challenge_sessions.start_time))
    `;
    conditions.push(comparatorToSql(durationExpr, query.duration));
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

export type SessionStatusUpdate = {
  uuid: string;
  status: SessionStatus;
  endTime: Date | null;
};

/**
 * Fetch current statuses for a list of sessions by UUID.
 * Used to update live session cards when sessions end.
 * @returns Statuses in the same order as the input UUIDs.
 */
export async function getSessionStatuses(
  uuids: string[],
): Promise<SessionStatusUpdate[]> {
  if (uuids.length === 0) {
    return [];
  }

  const sessions = await sql<
    { uuid: string; status: SessionStatus; end_time: Date | null }[]
  >`
    SELECT uuid, status, end_time
    FROM challenge_sessions
    WHERE uuid = ANY(${uuids})
  `;

  const byUuid = new Map(sessions.map((s) => [s.uuid, s]));

  return uuids
    .map((uuid) => {
      const s = byUuid.get(uuid);
      if (s === undefined) {
        return null;
      }
      return { uuid: s.uuid, status: s.status, endTime: s.end_time };
    })
    .filter((s) => s !== null);
}

/**
 * Loads detailed statistics for a session.
 *
 * @param uuid The UUID of the session to load.
 * @returns The session.
 */
export async function loadSessionWithStats(
  uuid: string,
): Promise<SessionWithStats | null> {
  let rawSession: SessionRow;

  try {
    const [result] = await sql<[SessionRow?]>`
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

  const rawChallenges = await sql<ChallengeRow[]>`
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

  const challengePlayersQuery = sql<
    {
      challenge_id: number;
      username: string;
      stage_deaths: Stage[];
      primary_gear: PrimaryMeleeGear;
      current_username: string;
    }[]
  >`
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

  const challengeSplitsQuery = sql<
    {
      challenge_id: number;
      type: SplitType;
      ticks: number;
      accurate: boolean;
    }[]
  >`
    SELECT challenge_id, type, ticks, accurate FROM challenge_splits
    WHERE challenge_id = ANY(${challengeIds})
  `;

  const personalBestsQuery = sql<
    { username: string; challenge_id: number; type: SplitType; ticks: number }[]
  >`
    SELECT p.username, cs.challenge_id, cs.type, cs.ticks
    FROM personal_best_history pbh
    JOIN challenge_splits cs ON pbh.challenge_split_id = cs.id
    JOIN players p ON p.id = pbh.player_id
    WHERE cs.challenge_id = ANY(${challengeIds})
      AND cs.type = ANY(${RELEVANT_PB_SPLITS})
    ORDER BY pbh.created_at ASC
  `;

  const challengeStatsAttach = attachChallengeStats(
    rawChallenges.map((c) => ({
      id: c.id,
      type: c.type,
      target: extraChallengeData[c.id],
    })),
  );

  const [challengePlayers, challengeSplits, personalBests] = await Promise.all([
    challengePlayersQuery,
    challengeSplitsQuery,
    personalBestsQuery,
    challengeStatsAttach,
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
    extraChallengeData[split.challenge_id].splits[split.type] = {
      ticks: split.ticks,
      accurate: split.accurate,
    };
  }

  const pbsByPlayer = new Map<string, Map<SplitType, number>>(
    party.map((p) => [p, new Map()]),
  );

  for (const pb of personalBests) {
    extraChallengeData[pb.challenge_id].personalBests.push({
      player: pb.username,
      type: pb.type,
      ticks: pb.ticks,
    });

    // PB rows are sorted by creation date, so the latest row is the fastest.
    pbsByPlayer.get(pb.username)?.set(pb.type, pb.ticks);
  }

  const challenges: SessionChallenge[] = rawChallenges.map((c) => ({
    uuid: c.uuid,
    type: c.type,
    status: c.status,
    mode: c.mode,
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
          type,
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
    challengeType: rawSession.challenge_type,
    challengeMode: rawSession.challenge_mode,
    scale: rawSession.scale,
    startTime: rawSession.start_time,
    endTime: rawSession.end_time,
    status: rawSession.status,
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
async function shapeSessions(
  rawSessions: SessionRow[],
): Promise<SessionWithChallenges[]> {
  if (rawSessions.length === 0) {
    return [];
  }

  const sessionsByUuid = new Map(
    rawSessions.map((s) => [
      s.uuid,
      { ...s, challenges: [] as ChallengeOverview[] },
    ]),
  );

  const [challenges] = await findChallenges(null, {
    session: rawSessions.map((s) => s.id),
  });

  if (challenges.length === 0) {
    logger.warn('no_challenges_for_sessions', {
      sessionUuids: rawSessions.map((s) => s.uuid),
    });
    return [];
  }

  for (const c of challenges) {
    sessionsByUuid.get(c.sessionUuid)?.challenges.push(c);
  }

  return rawSessions.map((session) => ({
    uuid: session.uuid,
    challengeType: session.challenge_type,
    challengeMode: session.challenge_mode,
    scale: session.scale,
    startTime: session.start_time,
    endTime: session.end_time,
    status: session.status,
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

export async function loadSessions(
  limit: number = 10,
  query: SessionQuery = {},
): Promise<SessionWithChallenges[]> {
  const { conditions, defaultSort } = sessionFilters(query);

  const sessions = await sql<SessionRow[]>`
    SELECT "challenge_sessions".*
    FROM challenge_sessions
    ${where(conditions)}
    ${order(defaultSort)}
    LIMIT ${limit}
  `;

  return shapeSessions(sessions);
}

export type SessionsPage = {
  sessions: SessionWithChallenges[];
  total: number;
  remaining: number;
};

/**
 * Loads a page of sessions along with total and remaining counts for
 * pagination.
 *
 * @param limit The maximum number of sessions to load.
 * @param query The query to filter sessions by.
 * @returns The page of sessions with pagination counts.
 */
export async function loadSessionsPage(
  limit: number,
  query: SessionQuery = {},
): Promise<SessionsPage> {
  const { conditions, defaultSort } = sessionFilters(query);
  const hasCursor = query.before !== undefined || query.after !== undefined;

  const mainQuery = sql<(SessionRow & { total_count: string })[]>`
    SELECT
      "challenge_sessions".*,
      COUNT(*) OVER () AS total_count
    FROM challenge_sessions
    ${where(conditions)}
    ${order(defaultSort)}
    LIMIT ${limit}
  `;

  // With a cursor, the window count above measures the cursor-filtered set,
  // not the absolute total; fetch the unfiltered total in parallel.
  let totalPromise: Promise<number | null> = Promise.resolve(null);
  if (hasCursor) {
    const unfilteredQuery: SessionQuery = {
      ...query,
      before: undefined,
      after: undefined,
    };
    totalPromise = aggregateSessions(unfilteredQuery, { '*': 'count' }).then(
      (r) => r?.['*']?.count ?? 0,
    );
  }

  const [rawSessions, unfilteredTotal] = await Promise.all([
    mainQuery,
    totalPromise,
  ]);

  if (rawSessions.length === 0) {
    return {
      sessions: [],
      total: unfilteredTotal ?? 0,
      remaining: 0,
    };
  }

  const windowCount = parseInt(rawSessions[0].total_count, 10);
  const sessions = await shapeSessions(rawSessions);

  if (sessions.length === 0) {
    return {
      sessions: [],
      total: hasCursor ? (unfilteredTotal ?? 0) : windowCount,
      remaining: 0,
    };
  }

  // `remaining` is the number of sessions beyond the current page in the
  // forward direction.
  let total: number;
  let remaining: number;
  if (!hasCursor) {
    total = windowCount;
    remaining = Math.max(0, total - sessions.length);
  } else if (query.before !== undefined) {
    total = unfilteredTotal ?? 0;
    remaining = Math.max(0, total - windowCount);
  } else {
    total = unfilteredTotal ?? 0;
    remaining = Math.max(0, windowCount - sessions.length);
  }

  return { sessions, total, remaining };
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

export type SessionAggregationOptions<
  F extends AggregationQuery = Record<string, Aggregations>,
> = {
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

    const invalidAggregations = aggs.filter((agg) => !isAggregation(agg));
    if (invalidAggregations.length > 0) {
      throw new InvalidQueryError(
        `Invalid aggregations: ${invalidAggregations.join(', ')}`,
      );
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
      sort = `${direction}${aggregateName(fieldName, agg)}#nl`;
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
      return {} as GroupedAggregationResult<F, G>;
    }
    if (hasCount) {
      return { '*': { count: 0 } } as AggregationResult<F>;
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

      result[field] ??= {};
      result[field][agg] = floatOrZero(value as string);
    });

    return result;
  }

  const result = {} as GroupedAggregationResult<AggregationQuery, string>;
  const groupingFieldsRaw = Array.isArray(grouping) ? grouping : [grouping!];

  // If grouping by party, we want to return a list of usernames rather than
  // the hash as the group key. Reconstruct the list from the players in the
  // first challenge of each session that has the party hash.
  const partyHashes = new Map<string, string[]>();

  if (groupingFieldsRaw.includes('party' as G)) {
    const partyField = sessionGroupingFieldToDb('party');
    for (const row of rows) {
      if (row[partyField]) {
        partyHashes.set(row[partyField] as string, []);
      }
    }

    const conditionsWithHash = [
      ...conditions,
      sql`party_hash = ANY(${Array.from(partyHashes.keys())})`,
    ];

    const partyUsernames = await sql<
      { party_hash: string; username: string }[]
    >`
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
    const groupResult = {} as AggregationResult<AggregationQuery>;

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

      groupResult[field] ??= {} as Record<Aggregation, number>;
      (groupResult[field] as Record<string, number>)[agg] = floatOrZero(
        value as string,
      );
    });

    let parent = result;

    groupingFieldsRaw.forEach((field: string, i) => {
      const dbField = sessionGroupingFieldToDb(field);
      let value = row[dbField] as string | number;

      if (field === 'party') {
        value = partyHashes.get(value as string)?.join(',') ?? value;
      }

      if (i === groupingFieldsRaw.length - 1) {
        parent[value] = groupResult;
      } else {
        parent[value] ??= {};
      }

      parent = parent[value] as unknown as GroupedAggregationResult<
        AggregationQuery,
        string
      >;
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
): Promise<Record<number, PlayerWithCurrentUsername[]>> {
  const players = await sql<
    { challenge_id: number; username: string; current_username: string }[]
  >`
    SELECT
      challenge_players.challenge_id,
      challenge_players.username,
      players.username AS current_username
    FROM challenge_players
    JOIN players ON challenge_players.player_id = players.id
    WHERE challenge_players.challenge_id = ANY(${challengeIds})
    ORDER BY challenge_players.orb
  `;

  return players.reduce<Record<number, PlayerWithCurrentUsername[]>>(
    (acc, player) => {
      acc[player.challenge_id] ??= [];
      acc[player.challenge_id].push({
        username: player.username,
        currentUsername: player.current_username,
      });
      return acc;
    },
    {},
  );
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
    const protos = await dataRepository.loadStageEvents(
      challengeId,
      stage,
      attempt,
    );
    const events = protos.map(protoToJsonEvent);
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
  id: number;
  stats: Omit<PlayerStats, 'playerId' | 'date'>;
  firstRecorded: Date;
};

type PlayerStatsRow = CamelToSnakeCase<PlayerStats> & {
  id: number;
  tob_verzik_p1_troll_specs: number;
  tob_verzik_p3_melees: number;
};

/**
 * Looks up a player by their username and fetches their most recent stats.
 * @param username The player's username.
 * @returns The player and their stats if found, `null` if not.
 */
export async function loadPlayerWithStats(
  username: string,
): Promise<PlayerWithStats | null> {
  const [playerWithStats] = await sql<
    ({
      player_id: number;
      username: string;
      total_recordings: number;
    } & PlayerStatsRow)[]
  >`
    SELECT
      players.id as player_id,
      players.username,
      players.total_recordings,
      player_stats.*
    FROM players
    JOIN player_stats ON players.id = player_stats.player_id
    WHERE players.normalized_username = ${normalizeRsn(username)}
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
    id: playerWithStats.player_id,
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
  const rows = await sql<
    { cid: string; date: Date; type: SplitType; scale: number; ticks: number }[]
  >`
    WITH player_id_cte AS (
      SELECT id
      FROM players
      WHERE normalized_username = ${normalizeRsn(username)}
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
  const statsFields: [Stage, string][] = [];
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

  const promises: Promise<void>[] = [];

  if (statsFields.length > 0) {
    const baseColumns = statsFields.map(([, field]) => field);
    const aggregateColumns = statsFields.flatMap(([stage, field], i) => {
      const sum = sql`SUM(${sql(field)}) AS ${sql(stage.toString())}`;
      return i > 0 ? [sql`, `, sum] : sum;
    });

    promises.push(
      sql<Record<string, string>[]>`
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
    // TODO(frolv): The only other challenge recorded currently are solo only,
    // so this hack works for now. Eventually, all deaths should be tracked
    // with player stats.
    promises.push(
      sql<{ stage: Stage; deaths: string }[]>`
        SELECT stage, COUNT(*) as deaths
        FROM challenges
        WHERE
          stage = ANY(${otherStages})
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

export type PlayerWithCurrentUsername = {
  username: string;
  currentUsername: string;
};

export type TiedTeam = {
  uuid: string;
  date: Date;
  party: PlayerWithCurrentUsername[];
};

export type RankedSplit = {
  uuid: string;
  date: Date;
  ticks: number;
  party: PlayerWithCurrentUsername[];
  splitType: SplitType;
  scale: number;
  tieCount: number;
  tiedTeams?: TiedTeam[];
};

/**
 * Returns the top `numRanks` split times for each split type and scale.
 *
 * The returned split times are unique. If multiple challenges have the same
 * time, the earliest one recorded is returned. The `tieCount` field indicates
 * how many other challenges share that time (excluding the first one), and
 * `tiedTeams` contains up to `tiedTeamsLimit` other challenges with the time.
 *
 * @param types The split types to fetch.
 * @param scale The challenge scale.
 * @param numRanks How many split times to fetch for each split type.
 * @param startTime Only return splits from challenges that started after
 *   this time.
 * @param tiedTeamsLimit Maximum number of tied teams to fetch per split
 *   (default 10). Set to 0 to skip fetching tied teams.
 * @returns Object mapping split types to an array of ranked split times.
 */
export async function findBestSplitTimes(
  types: SplitType[],
  scale: number,
  numRanks: number,
  startTime?: Date,
  tiedTeamsLimit: number = 10,
): Promise<Partial<Record<SplitType, RankedSplit[]>>> {
  const rankedSplits: Partial<Record<SplitType, RankedSplit[]>> = {};
  const partiesToUpdate: [number, RankedSplit][] = [];
  const tiedTeamsMap = new Map<SplitType, Map<number, [number, TiedTeam][]>>();

  await Promise.all(
    types.map(async (type) => {
      const topNTicks: {
        id: number;
        uuid: string;
        start_time: Date;
        ticks: number;
      }[] = await sql`
        SELECT DISTINCT ON (challenge_splits.ticks)
          challenges.id,
          challenges.uuid,
          challenges.start_time,
          challenge_splits.ticks
        FROM challenge_splits
        JOIN challenges ON challenge_splits.challenge_id = challenges.id
        WHERE
          challenge_splits.accurate
          AND challenge_splits.type = ${type}
          AND challenge_splits.scale = ${scale}
          ${startTime ? sql`AND challenges.start_time >= ${startTime}` : sql``}
        ORDER BY
          challenge_splits.ticks ASC,
          challenges.start_time ASC,
          challenges.id ASC
        LIMIT ${numRanks};
      `;

      if (topNTicks.length === 0) {
        return;
      }

      const winningTicks = topNTicks.map((r) => r.ticks);
      const rowsPerTick = Math.max(1, tiedTeamsLimit + 1);

      const tiedResults: {
        id: number;
        uuid: string;
        start_time: Date;
        ticks: number;
        total_count: string;
        row_num: string;
      }[] = await sql`
        WITH ranked AS (
          SELECT
            challenges.id,
            challenges.uuid,
            challenges.start_time,
            challenge_splits.ticks,
            COUNT(*) OVER (PARTITION BY challenge_splits.ticks) AS total_count,
            ROW_NUMBER() OVER (
              PARTITION BY challenge_splits.ticks
              ORDER BY challenges.start_time ASC, challenges.id ASC
            ) AS row_num
          FROM challenge_splits
          JOIN challenges ON challenge_splits.challenge_id = challenges.id
          WHERE
            challenge_splits.accurate
            AND challenge_splits.type = ${type}
            AND challenge_splits.scale = ${scale}
            AND challenge_splits.ticks = ANY(${winningTicks})
            ${startTime ? sql`AND challenges.start_time >= ${startTime}` : sql``}
        )
        SELECT id, uuid, start_time, ticks, total_count, row_num
        FROM ranked
        WHERE row_num <= ${rowsPerTick}
        ORDER BY ticks, row_num;
      `;

      const rowsByTick = new Map<
        number,
        {
          id: number;
          uuid: string;
          start_time: Date;
          total_count: string;
        }[]
      >();
      for (const row of tiedResults) {
        if (!rowsByTick.has(row.ticks)) {
          rowsByTick.set(row.ticks, []);
        }
        rowsByTick.get(row.ticks)!.push(row);
      }

      rankedSplits[type] = [];
      const ticksMap = new Map<number, [number, TiedTeam][]>();

      for (const w of topNTicks) {
        const rows = rowsByTick.get(w.ticks) ?? [];
        const tieCount =
          rows.length > 0 ? parseInt(rows[0].total_count, 10) - 1 : 0;

        const rankedSplit: RankedSplit = {
          uuid: w.uuid,
          date: w.start_time,
          ticks: w.ticks,
          party: [],
          splitType: type,
          scale,
          tieCount,
        };

        rankedSplits[type].push(rankedSplit);
        partiesToUpdate.push([w.id, rankedSplit]);

        if (tiedTeamsLimit > 0 && tieCount > 0 && rows.length > 0) {
          ticksMap.set(
            w.ticks,
            rows.map((r) => [
              r.id,
              { uuid: r.uuid, date: r.start_time, party: [] },
            ]),
          );
        }
      }

      if (ticksMap.size > 0) {
        tiedTeamsMap.set(type, ticksMap);
      }
    }),
  );

  const parties = await loadChallengeParties(partiesToUpdate.map((p) => p[0]));
  for (const [id, desc] of partiesToUpdate) {
    desc.party = parties[id];
  }

  const allTiedIds: number[] = [];
  for (const ticksMap of tiedTeamsMap.values()) {
    for (const teams of ticksMap.values()) {
      for (const [id] of teams) {
        allTiedIds.push(id);
      }
    }
  }

  if (allTiedIds.length > 0) {
    const tiedParties = await loadChallengeParties(allTiedIds);

    for (const ticksMap of tiedTeamsMap.values()) {
      for (const teams of ticksMap.values()) {
        for (const [id, team] of teams) {
          team.party = tiedParties[id] ?? [];
        }
      }
    }

    // Attach tied teams to ranked splits, excluding the primary team.
    for (const [splitType, splits] of Object.entries(rankedSplits)) {
      const ticksMap = tiedTeamsMap.get(parseInt(splitType) as SplitType);
      if (ticksMap === undefined) {
        continue;
      }

      for (const split of splits ?? []) {
        if (split.tieCount > 0) {
          const teams = ticksMap.get(split.ticks);
          if (teams === undefined) {
            continue;
          }

          split.tiedTeams = teams
            .filter(([, team]) => team.uuid !== split.uuid)
            .slice(0, tiedTeamsLimit)
            .map(([, team]) => team);
        }
      }
    }
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
    sql`players.normalized_username = ${normalizeRsn(username)}`,
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
    const rows = await sql<Partial<PlayerStatsRow>[]>`
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
      const { date, player_id: _playerId, id: _id, ...statsFields } = row;
      const stats: Partial<PlayerStats> = { date };

      for (const [key, value] of Object.entries(statsFields)) {
        const k = snakeToCamel(key) as keyof Omit<PlayerStats, 'date'>;
        stats[k] = value;
      }

      return stats;
    });
  } catch (e: unknown) {
    if (isPostgresUndefinedColumn(e)) {
      const err = e as Error;
      const missingField = /column ([^"]+) does not exist/.exec(err.message);
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

  const edges = await sql<
    { player_id_1: number; player_id_2: number; challenge_count: string }[]
  >`
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
    SELECT id FROM players WHERE normalized_username = ${normalizeRsn(username)}
  `.then((rows) => rows[0]?.id);

  if (!playerId) {
    return null;
  }

  const rows = await sql<
    {
      partner_id: number;
      challenges_together: string;
      first_challenge_date: Date;
      last_challenge_date: Date;
    }[]
  >`
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
