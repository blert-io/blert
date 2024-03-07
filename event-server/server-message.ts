import { Event } from '@blert/common';

export const enum ServerMessageType {
  RAID_START_RESPONSE = 'RAID_START_RESPONSE',
  RAID_EVENTS = 'RAID_EVENTS',
}

export type ServerMessage = {
  type: ServerMessageType;
};

export type RaidStartResponseMessage = ServerMessage & {
  type: ServerMessageType.RAID_START_RESPONSE;
  raidId: string;
};

export type RaidEventsMessage = ServerMessage & {
  type: ServerMessageType.RAID_EVENTS;
  events: Event[];
};
