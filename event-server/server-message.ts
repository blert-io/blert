import { Event, Raid } from '@blert/common';

export const enum ServerMessageType {
  CONNECTION_RESPONSE = 'CONNECTION_RESPONSE',
  RAID_HISTORY_REQUEST = 'RAID_HISTORY_REQUEST',
  RAID_HISTORY_RESPONSE = 'RAID_HISTORY_RESPONSE',
  RAID_START_RESPONSE = 'RAID_START_RESPONSE',
  RAID_EVENTS = 'RAID_EVENTS',
}

export type ServerMessage = {
  type: ServerMessageType;
};

export type ConnectionResponseMessage = ServerMessage & {
  type: ServerMessageType.CONNECTION_RESPONSE;
  user: {
    id: string;
    name: string;
  };
};

export type PastRaid = Pick<Raid, 'status' | 'mode' | 'party'> & { id: string };

export type RaidHistoryRequestMessage = ServerMessage & {
  type: ServerMessageType.RAID_HISTORY_REQUEST;
};

export type RaidHistoryResponseMessage = ServerMessage & {
  type: ServerMessageType.RAID_HISTORY_RESPONSE;
  history: PastRaid[];
};

export type RaidStartResponseMessage = ServerMessage & {
  type: ServerMessageType.RAID_START_RESPONSE;
  raidId: string;
};

export type RaidEventsMessage = ServerMessage & {
  type: ServerMessageType.RAID_EVENTS;
  events: Event[];
};
