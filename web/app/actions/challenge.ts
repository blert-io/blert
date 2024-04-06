'use server';

import {
  ChallengeStatus,
  ChallengeType,
  Event,
  EventType,
  PersonalBest,
  PersonalBestModel,
  Player,
  PlayerAttackEvent,
  PlayerModel,
  PlayerStats,
  PlayerStatsModel,
  PlayerUpdateEvent,
  Raid,
  RaidModel,
  RoomEvent,
  Stage,
} from '@blert/common';
import { FilterQuery } from 'mongoose';

import connectToDatabase from './db';
import { defaultItemCache } from '../utils/item-cache';

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
): Promise<Raid | null> {
  await connectToDatabase();

  const challenge = await RaidModel.findOne({ _id: id, type }).lean().exec();
  if (challenge === null) {
    return null;
  }

  const players = await PlayerModel.find(
    { _id: { $in: challenge.partyIds } },
    { username: 1 },
  )
    .lean()
    .exec();

  // Add each player's current username to enable linking to their profile.
  challenge.party.forEach((_, i) => {
    const player = players.find((pl) => pl._id.equals(challenge.partyIds[i]));
    challenge.partyInfo[i].currentUsername =
      player !== undefined ? player.username : '';
  });

  return challenge;
}

/**
 * Fetches all of the events for a specified stage in a challenge.
 * @param challengeId UUID of the challenge.
 * @param stage The stage whose events to fetch.
 * @returns Array of events for the stage, empty if none exist.
 */
export async function loadEventsForStage(
  challengeId: string,
  stage: Stage,
  type?: EventType,
): Promise<Event[]> {
  await connectToDatabase();

  let query: FilterQuery<Event> = { cId: challengeId, stage };
  if (type !== undefined) {
    query.type = type;
  }

  const roomEvents = await RoomEvent.find(query, {
    _id: 0,
    __v: 0,
    cId: 0,
    stage: 0,
  })
    .lean()
    .exec();

  // Item names are not stored in the database: load them from the item cache.
  // TODO(frolv): This doesn't have to be done here either, as it results in a
  // ton of duplicate strings in the payload. Instead, the cache could be sent
  // to the client and used there on demand.
  for (const event of roomEvents) {
    if (event.type === EventType.PLAYER_UPDATE) {
      const e = event as unknown as PlayerUpdateEvent;
      if (e.player.equipment) {
        Object.values(e.player.equipment).forEach((item) => {
          if (item) {
            item.name = defaultItemCache.getItemName(item.id);
          }
        });
      }
    } else if (event.type === EventType.PLAYER_ATTACK) {
      const e = event as unknown as PlayerAttackEvent;
      if (e.attack.weapon) {
        e.attack.weapon.name = defaultItemCache.getItemName(e.attack.weapon.id);
      }
    }
  }

  return roomEvents ? (roomEvents as unknown as Event[]) : [];
}

export type ChallengeOverview = Pick<
  Raid,
  | '_id'
  | 'type'
  | 'stage'
  | 'startTime'
  | 'status'
  | 'mode'
  | 'party'
  | 'partyInfo'
  | 'totalTicks'
  | 'totalDeaths'
>;

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
  await connectToDatabase();

  let query = RaidModel.find();

  if (type !== undefined) {
    query = query.where({ type });
  }

  if (username !== undefined) {
    const player = await PlayerModel.findOne({ username }).exec();
    if (player !== null) {
      query = query.where({ partyIds: player._id });
    } else {
      // This shouldn't happen, but fallback to username search if the player
      // isn't found for some reason.
      console.error(
        `loadRecentChallengeInformation: Player not found: ${username}`,
      );
      query = query
        .where({ party: username })
        .collation({ locale: 'en', strength: 2 });
    }
  }

  const challenges = await query
    .select({
      _id: 1,
      type: 1,
      startTime: 1,
      status: 1,
      stage: 1,
      mode: 1,
      party: 1,
      partyInfo: 1,
      totalTicks: 1,
      totalDeaths: 1,
    })
    .sort({ startTime: -1 })
    .limit(limit)
    .lean()
    .exec();

  return challenges ? (challenges as ChallengeOverview[]) : [];
}

export type ChallengeStats = {
  total: number;
  completions: number;
  resets: number;
  wipes: number;
};

export async function loadAggregateChallengeStats(
  type?: ChallengeType,
): Promise<ChallengeStats> {
  await connectToDatabase();

  const match: FilterQuery<Raid> = {
    status: { $ne: ChallengeStatus.IN_PROGRESS },
  };
  if (type !== undefined) {
    match.type = type;
  }

  const pipeline = [
    { $match: match },
    {
      $group: {
        _id: '$status',
        amount: { $sum: 1 },
      },
    },
  ];

  const stats = await RaidModel.aggregate(pipeline).exec();

  return stats.reduce(
    (acc, stat) => {
      if (stat._id === ChallengeStatus.COMPLETED) {
        acc.completions = stat.amount;
      } else if (stat._id === ChallengeStatus.RESET) {
        acc.resets = stat.amount;
      } else if (stat._id === ChallengeStatus.WIPED) {
        acc.wipes = stat.amount;
      }
      acc.total += stat.amount;
      return acc;
    },
    { total: 0, completions: 0, resets: 0, wipes: 0 },
  );
}

export type PlayerWithStats = Omit<Player, '_id'> & {
  stats: Omit<PlayerStats, 'playerId'>;
};

/**
 * Looks up a player by their username and fetches their most recent stats.
 * @param username The player's username.
 * @returns The player and their stats if found, `null` if not.
 */
export async function loadPlayerWithStats(
  username: string,
): Promise<PlayerWithStats | null> {
  await connectToDatabase();

  username = username.toLowerCase();
  const player = await PlayerModel.findOne({ username }).lean();
  if (player === null) {
    return null;
  }
  const stats = await PlayerStatsModel.findOne(
    { playerId: player._id },
    { _id: 0, playerId: 0 },
    {
      sort: { date: -1 },
    },
  ).lean();

  if (stats === null) {
    return null;
  }

  const { _id, ...playerWithoutId } = player;
  return { ...playerWithoutId, stats };
}

export async function loadPbsForPlayer(
  username: string,
): Promise<PersonalBest[]> {
  await connectToDatabase();

  const player = await PlayerModel.findOne(
    { username: username.toLowerCase() },
    { _id: 1 },
  ).exec();
  if (player === null) {
    return [];
  }

  // TODO(frolv): Filter by type/scale.
  const pbs = await PersonalBestModel.find(
    { playerId: player._id },
    { _id: 0, playerId: 0 },
  )
    .lean()
    .exec();

  return pbs;
}

export async function getTotalDeathsByStage(
  stages: Stage[],
): Promise<Record<Stage, number>> {
  await connectToDatabase();

  const stagesWithDeaths = await RoomEvent.aggregate([
    { $match: { type: EventType.PLAYER_DEATH, stage: { $in: stages } } },
    { $group: { _id: '$stage', deaths: { $sum: 1 } } },
  ]).exec();

  return stagesWithDeaths.reduce((acc, stage) => {
    acc[stage._id] = stage.deaths;
    return acc;
  }, {});
}
