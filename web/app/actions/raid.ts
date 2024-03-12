'use server';

import {
  Event,
  Player,
  PlayerModel,
  PlayerStats,
  PlayerStatsModel,
  Raid,
  RaidModel,
  Room,
  RoomEvent,
} from '@blert/common';
import { cache } from 'react';
import connectToDatabase from './db';

/**
 * Fetches the raid with the specific ID from the database.
 *
 * @param id UUID of the raid.
 * @returns The raid object if found, `null` if not.
 */
export async function loadRaid(id: string): Promise<Raid | null> {
  await connectToDatabase();

  const raid = await RaidModel.findOne({ _id: id }).lean();

  return raid ? (raid as Raid) : null;
}

async function _loadEventsForRoom(
  raidId: string,
  room: Room,
): Promise<Event[]> {
  await connectToDatabase();

  const roomEvents = await RoomEvent.find({ raidId, room }, { _id: 0 }).lean();
  return roomEvents ? (roomEvents as unknown as Event[]) : [];
}

/**
 * Fetches all of the room events for a specified room in a raid.
 * @param raidId UUID of the raid.
 * @param room The room whose events to fetch.
 * @returns Array of events for the room, empty if none exist.
 */
export const loadEventsForRoom = cache(_loadEventsForRoom);

export type RaidOverview = Pick<
  Raid,
  | '_id'
  | 'startTime'
  | 'status'
  | 'mode'
  | 'party'
  | 'partyInfo'
  | 'totalRoomTicks'
  | 'totalDeaths'
>;

/**
 * Fetches basic information about the most recently recorded raids from
 * the database.
 *
 * @param limit Maximum number of raids to fetch.
 * @param username If present, only fetch raids that the user participated in.
 * @returns Array of raids.
 */
export async function loadRecentRaidInformation(
  limit: number,
  username?: string,
): Promise<RaidOverview[]> {
  await connectToDatabase();

  let query = RaidModel.find();

  if (username) {
    query = query
      .where({ party: username })
      .collation({ locale: 'en', strength: 2 });
  }
  const raids = await query
    .select({
      _id: 1,
      startTime: 1,
      status: 1,
      mode: 1,
      party: 1,
      partyInfo: 1,
      totalRoomTicks: 1,
      totalDeaths: 1,
    })
    .sort({ startTime: -1 })
    .limit(limit)
    .lean()
    .exec();

  return raids ? (raids as RaidOverview[]) : [];
}

export type PlayerWithStats = Player & { stats: Omit<PlayerStats, 'username'> };

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
  const promises = [
    PlayerModel.findOne({ username }, { _id: 0 }).lean() as Promise<Player>,
    PlayerStatsModel.findOne(
      { username },
      { _id: 0, username: 0 },
      {
        sort: { date: -1 },
      },
    ).lean(),
  ];

  const [player, stats] = (await Promise.all(promises)) as [
    Player,
    PlayerStats,
  ];
  if (player === null || stats === null) {
    return null;
  }

  return { ...player, stats };
}
