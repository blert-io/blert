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
  generalizeSplit,
} from '@blert/common';
import postgres from 'postgres';

import { sql } from './db';
import dataRepository from './data-repository';

function where(conditions: postgres.Fragment[]): postgres.Fragment {
  return conditions.length > 0
    ? sql`WHERE ${conditions.flatMap((c, i) => (i > 0 ? [sql`AND`, c] : c))}`
    : sql``;
}

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

/**
 * Fetches basic information about the most recently recorded challenges from
 * the database.
 *
 * @param limit Maximum number of challenges to fetch.
 * @param type If set, only fetch challenges of this type.
 * @param username If present, only fetch challenges the user participated in.
 * @returns Array of challenges.
 */
export async function loadRecentChallenges(
  limit: number,
  type?: ChallengeType,
  username?: string,
): Promise<ChallengeOverview[]> {
  let tables;
  let conditions = [];

  if (username !== undefined) {
    tables = sql`challenges
      JOIN challenge_players ON challenges.id = challenge_players.challenge_id 
      JOIN players ON challenge_players.player_id = players.id
    `;
    conditions.push(sql`lower(players.username) = ${username.toLowerCase()}`);
  } else {
    tables = sql`challenges`;
  }

  if (type !== undefined) {
    conditions.push(sql`challenges.type = ${type}`);
  }

  const rawChallenges = await sql`
    SELECT
      challenges.id,
      challenges.uuid,
      challenges.type,
      challenges.start_time,
      challenges.status,
      challenges.stage,
      challenges.mode,
      challenges.challenge_ticks,
      challenges.total_deaths
    FROM ${tables}
    ${where(conditions)}
    ORDER BY challenges.start_time DESC
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
