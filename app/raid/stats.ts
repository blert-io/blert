export const enum EventType {
  PLAYER = 'PLAYER',
}

export const enum RaidStatus {
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  MAIDEN_RESET = 'MAIDEN_RESET',
  MAIDEN_WIPE = 'MAIDEN_WIPE',
  BLOAT_RESET = 'BLOAT_RESET',
  BLOAT_WIPE = 'BLOAT_WIPE',
  NYLO_RESET = 'NYLO_RESET',
  NYLO_WIPE = 'NYLO_WIPE',
  SOTE_RESET = 'SOTE_RESET',
  SOTE_WIPE = 'SOTE_WIPE',
  XARPUS_RESET = 'XARPUS_RESET',
  XARPUS_WIPE = 'XARPUS_WIPE',
  VERZIK_WIPE = 'VERZIK_WIPE',
}

export type RaidStats = {
  id: string;
  players: string[];
  status: RaidStatus;
  rooms: {
    maiden?: RoomStats;
    bloat?: RoomStats;
    nylocas?: RoomStats;
    sotetseg?: RoomStats;
    xarpus?: RoomStats;
    verzik?: RoomStats;
  };
};

export interface RoomStats {
  events: any[];
}
