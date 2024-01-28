export type Raid = {
  _id: string;
  status: RaidStatus;
  mode: Mode;
  startTime: Date;
  party: string[];
  totalRoomTicks: number;
  rooms: {
    [room in Room]?: RoomOverview;
  };
};

export type RoomOverview = {
  roomTicks: number;
};

export enum Room {
  MAIDEN = 'MAIDEN',
  BLOAT = 'BLOAT',
  NYLOCAS = 'NYLOCAS',
  SOTETSEG = 'SOTETSEG',
  XARPUS = 'XARPUS',
  VERZIK = 'VERZIK',
}

export enum Mode {
  ENTRY = 'ENTRY',
  REGULAR = 'REGULAR',
  HARD = 'HARD',
}

export enum RaidStatus {
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

export enum RoomStatus {
  STARTED = 'STARTED',
  COMPLETED = 'COMPLETED',
  WIPED = 'WIPED',
}

export enum Skill {
  HITPOINTS,
}

export type SkillLevel = {
  skill: Skill;
  current: number;
  base: number;
};

export enum MaidenCrabSpawn {
  SEVENTIES = 'SEVENTIES',
  FIFTIES = 'FIFTIES',
  THIRTIES = 'THIRTIES',
}

export enum MaidenCrabPosition {
  N1 = 'N1',
  N2 = 'N2',
  N3 = 'N3',
  N4_INNER = 'N4_INNER',
  N4_OUTER = 'N4_OUTER',
  S1 = 'S1',
  S2 = 'S2',
  S3 = 'S3',
  S4_INNER = 'S4_INNER',
  S4_OUTER = 'S4_OUTER',
}
