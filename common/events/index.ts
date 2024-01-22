// TODO(frolv): Split this file up.

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
  events: Event[];
}

export enum Room {
  MAIDEN = 'MAIDEN',
  BLOAT = 'BLOAT',
  NYLOCAS = 'NYLOCAS',
  SOTETSEG = 'SOTETSEG',
  XARPUS = 'XARPUS',
  VERZIK = 'VERZIK',
}

export enum EventType {
  RAID_START = 'RAID_START',
  RAID_END = 'RAID_END',
  ROOM_STATUS = 'ROOM_STATUS',
  PLAYER_UPDATE = 'PLAYER_UPDATE',
  NPC_UPDATE = 'NPC_UPDATE',
  MAIDEN_CRAB_SPAWN = 'MAIDEN_CRAB_SPAWN',
  MAIDEN_BLOOD_SPLATS = 'MAIDEN_BLOOD_SPLATS',
}

export interface Event {
  type: EventType;
  raidId?: string;
  room?: Room;
  tick: number;
  xCoord: number;
  yCoord: number;
}

export interface RaidStartEvent extends Event {
  type: EventType.RAID_START;
  raidInfo: RaidInfo;
}

export interface RoomStatusEvent extends Event {
  type: EventType.ROOM_STATUS;
  roomStatus: RoomStatus;
}

export interface PlayerUpdateEvent extends Event {
  type: EventType.PLAYER_UPDATE;
  player: Player;
}

export interface NpcUpdateEvent extends Event {
  type: EventType.NPC_UPDATE;
  npc: Npc;
}

export interface MaidenCrabSpawnEvent extends Event {
  type: EventType.MAIDEN_CRAB_SPAWN;
  maidenEntity: MaidenEntity;
}

export interface MaidenBloodSplatsEvent extends Event {
  type: EventType.MAIDEN_CRAB_SPAWN;
  maidenEntity: MaidenEntity;
}

export enum Mode {
  ENTRY = 'ENTRY',
  REGULAR = 'REGULAR',
  HARD = 'HARD',
}

export type RaidInfo = {
  party: string[];
  mode?: Mode;
};

export enum RoomStatus {
  STARTED = 'STARTED',
  COMPLETED = 'COMPLETED',
  WIPED = 'WIPED',
}

export type Player = {
  name: string;
  hitpoints?: SkillLevel;
  equipment?: EquipmentMap;
};

export type Item = {
  id: number;
  name: string;
  quantity: number;
};

export enum EquipmentSlot {
  HEAD = 'HEAD',
}

export type EquipmentMap = {
  [key in EquipmentSlot]: Item;
};

export type Npc = {
  id: number;
  roomId: number;
  hitpoints?: SkillLevel;
};

export enum Skill {
  HITPOINTS,
}

export type SkillLevel = {
  skill: Skill;
  current: number;
  base: number;
};

export type Coords = {
  x: number;
  y: number;
};

export type MaidenEntity = {
  bloodSplats?: Coords[];
  crab?: MaidenCrab;
};

export type MaidenCrab = {
  spawn: MaidenCrabSpawn;
  position: MaidenCrabPosition;
  scuffed: boolean;
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
