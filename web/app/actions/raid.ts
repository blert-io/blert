'use server';

import {
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
  Room,
  RoomEvent,
} from '@blert/common';
import { FilterQuery } from 'mongoose';

import connectToDatabase from './db';
import { defaultItemCache } from '../utils/item-cache';

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

/**
 * Fetches all of the room events for a specified room in a raid.
 * @param raidId UUID of the raid.
 * @param room The room whose events to fetch.
 * @returns Array of events for the room, empty if none exist.
 */
export async function loadEventsForRoom(
  raidId: string,
  room: Room,
  type?: EventType,
): Promise<Event[]> {
  await connectToDatabase();

  let query: FilterQuery<Event> = { raidId, room };
  if (type !== undefined) {
    query.type = type;
  }

  const roomEvents = await RoomEvent.find(query, {
    _id: 0,
    __v: 0,
    raidId: 0,
    room: 0,
  }).lean();

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

export type RaidOverview = Pick<
  Raid,
  | '_id'
  | 'stage'
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
      stage: 1,
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

export async function loadPbsForPlayer(
  username: string,
): Promise<PersonalBest[]> {
  await connectToDatabase();

  // TODO(frolv): Filter by type/scale.
  const pbs = await PersonalBestModel.find(
    {
      username: username.toLowerCase(),
    },
    { _id: 0 },
  )
    .lean()
    .exec();

  return pbs;
}
