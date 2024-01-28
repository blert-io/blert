'use server';

import { Event, Raid, RaidModel, Room, RoomEvent } from '@blert/common';
import { cache } from 'react';

/**
 * Fetches the raid with the specific ID from the database.
 *
 * @param id UUID of the raid.
 * @returns The raid object if found, `null` if not.
 */
export async function loadRaid(id: string): Promise<Raid | null> {
  const raid = await RaidModel.findOne({ _id: id }).lean();
  return raid ? (raid as Raid) : null;
}

async function _loadEventsForRoom(
  raidId: string,
  room: Room,
): Promise<Event[]> {
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
