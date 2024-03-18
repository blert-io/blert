import { Event, Raid } from '@blert/common';

export const enum ServerMessageType {
  HEARTBEAT_PING = 'HEARTBEAT_PING',
  HEARTBEAT_PONG = 'HEARTBEAT_PONG',
  CONNECTION_RESPONSE = 'CONNECTION_RESPONSE',
  RAID_HISTORY_REQUEST = 'RAID_HISTORY_REQUEST',
  RAID_HISTORY_RESPONSE = 'RAID_HISTORY_RESPONSE',
  RAID_START_RESPONSE = 'RAID_START_RESPONSE',
  RAID_EVENTS = 'RAID_EVENTS',
}

export interface ServerMessage {
  type: ServerMessageType;
}

export interface ConnectionResponseMessage extends ServerMessage {
  type: ServerMessageType.CONNECTION_RESPONSE;
  user: {
    id: string;
    name: string;
  };
}

export type PastRaid = Pick<Raid, 'status' | 'mode' | 'party'> & { id: string };

export interface RaidHistoryRequestMessage extends ServerMessage {
  type: ServerMessageType.RAID_HISTORY_REQUEST;
}

export interface RaidHistoryResponseMessage extends ServerMessage {
  type: ServerMessageType.RAID_HISTORY_RESPONSE;
  history: PastRaid[];
}

export interface RaidStartResponseMessage extends ServerMessage {
  type: ServerMessageType.RAID_START_RESPONSE;
  raidId: string | null;
}

export interface RaidEventsMessage extends ServerMessage {
  type: ServerMessageType.RAID_EVENTS;
  events: Event[];
}
