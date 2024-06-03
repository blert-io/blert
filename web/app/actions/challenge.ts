'use server';

import {
  Challenge,
  ChallengeMode,
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
import { Comparator, Join, join, operator, where } from './query';

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
  | 'totalDeaths'
> & { party: string[] };

export type SortQuery<T> = `${'+' | '-'}${keyof T & string}`;

export type ChallengeQuery = {
  type?: ChallengeType;
  mode?: ChallengeMode;
  status?: ChallengeStatus;
  scale?: number;
  party?: string[];
  splits?: Array<Comparator<SplitType, number>>;
  sort?: SortQuery<Omit<ChallengeOverview, 'party'>>;
};

const DEFAULT_CHALLENGE_LIMIT = 10;
const DEFAULT_CHALLENGE_QUERY: ChallengeQuery = {
  sort: '-startTime',
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
    case 'total_deaths':
      return 'challenges';

    default:
      throw new InvalidQueryError(`Unknown field: ${field}`);
  }
}

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
): Promise<ChallengeOverview[]> {
  const searchQuery = { ...DEFAULT_CHALLENGE_QUERY, ...query };

  let challengeTable = 'challenges';

  let baseTable = sql`challenges`;
  const joins: Join[] = [];
  const conditions = [];

  if (searchQuery.party !== undefined) {
    if (searchQuery.party.length === 0) {
      return [];
    }

    if (searchQuery.party.length === 1) {
      const username = searchQuery.party[0];
      joins.push(
        {
          table: sql`challenge_players`,
          on: sql`challenges.id = challenge_players.challenge_id`,
        },
        {
          table: sql`players`,
          on: sql`challenge_players.player_id = players.id`,
        },
      );
      conditions.push(sql`lower(players.username) = ${username.toLowerCase()}`);
    } else {
      baseTable = sql`(
        SELECT challenges.*
        FROM challenges
        JOIN challenge_players ON challenges.id = challenge_players.challenge_id
        JOIN players ON challenge_players.player_id = players.id
        WHERE lower(players.username) = ANY(${searchQuery.party.map((u) => u.toLowerCase())})
        GROUP BY challenges.id
        HAVING COUNT(*) = ${searchQuery.party.length}
      ) partied_challenges`;
      challengeTable = 'partied_challenges';
    }
  }

  const sqlChallenges = sql(challengeTable);

  if (searchQuery.splits !== undefined && searchQuery.splits.length > 0) {
    const splitConditions = searchQuery.splits.map(([type, op, value]) => {
      let types: SplitType[];
      if (searchQuery.mode !== undefined) {
        types = [adjustSplitForMode(generalizeSplit(type), searchQuery.mode)];
      } else {
        types = allSplitModes(type);
      }
      return sql`(type = ANY(${types}) AND ticks ${operator(op)} ${value})`;
    });

    joins.push({
      table: sql`(
        SELECT challenge_id
        FROM challenge_splits
        ${where(splitConditions, 'or')} AND accurate
        GROUP BY challenge_id
        HAVING COUNT(*) = ${searchQuery.splits.length}
      ) filtered_splits`,
      on: sql`${sqlChallenges}.id = filtered_splits.challenge_id`,
    });
  }

  if (searchQuery.type !== undefined) {
    conditions.push(sql`${sqlChallenges}.type = ${searchQuery.type}`);
  }
  if (searchQuery.mode !== undefined) {
    conditions.push(sql`${sqlChallenges}.mode = ${searchQuery.mode}`);
  }
  if (searchQuery.status !== undefined) {
    conditions.push(sql`${sqlChallenges}.status = ${searchQuery.status}`);
  }
  if (searchQuery.scale !== undefined) {
    conditions.push(sql`${sqlChallenges}.scale = ${searchQuery.scale}`);
  }

  let order;
  if (searchQuery.sort !== undefined) {
    const field = camelToSnake(searchQuery.sort.slice(1));
    const table = fieldToTable(field);
    const sqlTable = table === 'challenges' ? sqlChallenges : sql(table);
    if (searchQuery.sort.startsWith('-')) {
      order = sql`${sqlTable}.${sql(field)} DESC`;
    } else {
      order = sql`${sqlTable}.${sql(field)} ASC`;
    }
  } else {
    order = sql`${sqlChallenges}.start_time DESC`;
  }

  const rawChallenges = await sql`
    SELECT
      ${sqlChallenges}.id,
      ${sqlChallenges}.uuid,
      ${sqlChallenges}.type,
      ${sqlChallenges}.start_time,
      ${sqlChallenges}.status,
      ${sqlChallenges}.stage,
      ${sqlChallenges}.mode,
      ${sqlChallenges}.challenge_ticks,
      ${sqlChallenges}.total_deaths
    FROM ${baseTable}
    ${join(joins)}
    ${where(conditions)}
    ORDER BY ${order}
    LIMIT ${limit}
  `;
  const players = await sql`
    SELECT challenge_id, username, primary_gear, orb
    FROM challenge_players
    WHERE challenge_id = ANY(${rawChallenges.map((c) => c.id)})
    ORDER BY orb
  `;

  const challenges = rawChallenges.map((c): ChallengeOverview => {
    const party = players
      .filter((p) => p.challenge_id === c.id)
      .map((p) => p.username);
    return {
      uuid: c.uuid,
      type: c.type,
      startTime: c.start_time,
      status: c.status,
      stage: c.stage,
      mode: c.mode,
      challengeTicks: c.challenge_ticks,
      totalDeaths: c.total_deaths,
      party,
    };
  });

  return challenges as ChallengeOverview[];
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

export async function getTotalDeathsByStage(
  stages: Stage[],
): Promise<Record<Stage, number>> {
  const stagesAndDeaths = await sql`
    SELECT stage, COUNT(*) as deaths
    FROM queryable_events
    WHERE event_type = ${EventType.PLAYER_DEATH} AND stage = ANY(${stages})
    GROUP BY stage
  `;
  return stagesAndDeaths.reduce((acc, stage) => {
    acc[stage.stage] = parseInt(stage.deaths);
    return acc;
  }, {});
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
