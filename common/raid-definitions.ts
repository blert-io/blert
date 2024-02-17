import { Coords } from './event';

export type Raid = {
  _id: string;
  status: RaidStatus;
  mode: Mode;
  startTime: Date;
  party: string[];
  totalRoomTicks: number;
  totalDeaths: number;
  rooms: Rooms;
};

export type Rooms = {
  [Room.MAIDEN]: MaidenOverview | null;
  [Room.BLOAT]: BloatOverview | null;
  [Room.NYLOCAS]: NyloOverview | null;
  [Room.SOTETSEG]: SoteOverview | null;
  [Room.XARPUS]: XarpusOverview | null;
  [Room.VERZIK]: VerzikOverview | null;
};

export interface RoomOverview {
  roomTicks: number;
  deaths: string[];
  npcs: Map<String, RoomNpc>;
}

export interface MaidenOverview extends RoomOverview {
  splits: MaidenSplits;
}

export interface BloatOverview extends RoomOverview {
  splits: BloatSplits;
}

export interface NyloOverview extends RoomOverview {
  splits: NyloSplits;
}

export interface SoteOverview extends RoomOverview {
  splits: SoteSplits;
}

export interface XarpusOverview extends RoomOverview {
  splits: XarpusSplits;
}

export interface VerzikOverview extends RoomOverview {
  redCrabSpawns: number;
  splits: VerzikSplits;
}

export type MaidenSplits = {
  [spawn in MaidenCrabSpawn]: number;
};

export type BloatSplits = {
  downTicks: number[];
};

export type NyloSplits = {
  capIncrease: number;
  waves: number;
  cleanup: number;
  boss: number;
};

export type SoteSplits = {
  [maze in Maze]: number;
};

export type XarpusSplits = {
  exhumes: number;
  screech: number;
};

export type VerzikSplits = {
  p1: number;
  reds: number;
  p2: number;
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
  ENTERED = 'ENTERED',
  STARTED = 'STARTED',
  COMPLETED = 'COMPLETED',
  WIPED = 'WIPED',
}

export enum RoomNpcType {
  BASIC = 'BASIC',
  MAIDEN_CRAB = 'MAIDEN_CRAB',
  NYLO = 'NYLO',
}

export interface RoomNpc {
  /** Unique identifier for the NPC within its room. */
  roomId: number;

  /**
   * Runescape NPC ID of the NPC at the time that it spawned.
   * The NPC ID may change throughout an NPC's lifetime; `NPC_UPDATE` events for
   * this NPC's `roomId` will reflect this.
   */
  spawnNpcId: number;

  spawnTick: number;
  spawnPoint: Coords;
  deathTick: number;
  deathPoint: Coords;

  type: RoomNpcType;
}

export interface MaidenCrab extends RoomNpc {
  type: RoomNpcType.MAIDEN_CRAB;
  maidenCrab: MaidenCrabProperties;
}

export type MaidenCrabProperties = {
  spawn: MaidenCrabSpawn;
  position: MaidenCrabPosition;
  scuffed: boolean;
};

export interface Nylo extends RoomNpc {
  type: RoomNpcType.NYLO;
  nylo: NyloProperties;
}

export type NyloProperties = {
  /**
   * Room ID of the big nylo which spawned this nylo split, or 0 if this nylo
   * is a spawn.
   */
  parentRoomId: number;

  /** Wave on which the nylo spawned. */
  wave: number;

  /** Attack style of the nylo when it spawned. */
  style: NyloStyle;

  /** Spawn location of the nylo. */
  spawnType: NyloSpawn;
};

export enum Skill {
  HITPOINTS,
}

export type SkillLevel = {
  skill: Skill;
  current: number;
  base: number;
};

export enum PlayerAttack {
  BGS_SMACK = 'BGS_SMACK',
  BGS_SPEC = 'BGS_SPEC',
  BLOWPIPE = 'BLOWPIPE',
  CHALLY_SPEC = 'CHALLY_SPEC',
  CHIN_BLACK = 'CHIN_BLACK',
  CHIN_GREY = 'CHIN_GREY',
  CHIN_RED = 'CHIN_RED',
  CLAW_SCRATCH = 'CLAW_SCRATCH',
  CLAW_SPEC = 'CLAW_SPEC',
  DAWN_SPEC = 'DAWN_SPEC',
  FANG = 'FANG',
  HAMMER_BOP = 'HAMMER_BOP',
  HAMMER_SPEC = 'HAMMER_SPEC',
  HAM_JOINT = 'HAM_JOINT',
  KODAI_BARRAGE = 'KODAI_BARRAGE',
  KODAI_BASH = 'KODAI_BASH',
  SAELDOR = 'SAELDOR',
  SANG = 'SANG',
  SANG_BARRAGE = 'SANG_BARRAGE',
  SCEPTRE_BARRAGE = 'SCEPTRE_BARRAGE',
  SCYTHE = 'SCYTHE',
  SCYTHE_UNCHARGED = 'SCYTHE_UNCHARGED',
  SHADOW = 'SHADOW',
  SHADOW_BARRAGE = 'SHADOW_BARRAGE',
  SWIFT = 'SWIFT',
  TENT_WHIP = 'TENT_WHIP',
  TOXIC_TRIDENT = 'TOXIC_TRIDENT',
  TOXIC_TRIDENT_BARRAGE = 'TOXIC_TRIDENT_BARRAGE',
  TOXIC_STAFF_BARRAGE = 'TOXIC_STAFF_BARRAGE',
  TOXIC_STAFF_SWIPE = 'TOXIC_STAFF_SWIPE',
  TRIDENT = 'TRIDENT',
  TRIDENT_BARRAGE = 'TRIDENT_BARRAGE',
  TWISTED_BOW = 'TWISTED_BOW',
  ZCB = 'ZCB',
}

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

export enum NyloStyle {
  MELEE = 'MELEE',
  RANGE = 'RANGE',
  MAGE = 'MAGE',
}

export enum NyloSpawn {
  EAST = 'EAST',
  SOUTH = 'SOUTH',
  WEST = 'WEST',
  SPLIT = 'SPLIT',
}

export enum Maze {
  MAZE_66 = 'MAZE_66',
  MAZE_33 = 'MAZE_33',
}

export enum XarpusPhase {
  /** Exhumes */
  P1 = 'P1',
  /** Spitting acid */
  P2 = 'P2',
  /** Post screech staring */
  P3 = 'P3',
}

export enum VerzikPhase {
  IDLE = 'IDLE',
  P1 = 'P1',
  P2 = 'P2',
  P3 = 'P3',
}
