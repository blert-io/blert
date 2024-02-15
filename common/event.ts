import {
  MaidenCrabPosition,
  MaidenCrabSpawn,
  Mode,
  SkillLevel,
  Room,
  RoomStatus,
  PlayerAttack,
  Maze,
  XarpusPhase,
  VerzikPhase,
  NyloStyle,
  NyloSpawn,
  RoomNpcType,
  NyloProperties,
  MaidenCrabProperties,
  VerzikCrabProperties,
} from './raid-definitions';

export enum EventType {
  RAID_START = 'RAID_START',
  RAID_END = 'RAID_END',
  RAID_UPDATE = 'RAID_UPDATE',
  ROOM_STATUS = 'ROOM_STATUS',
  PLAYER_UPDATE = 'PLAYER_UPDATE',
  PLAYER_ATTACK = 'PLAYER_ATTACK',
  PLAYER_DEATH = 'PLAYER_DEATH',
  NPC_SPAWN = 'NPC_SPAWN',
  NPC_UPDATE = 'NPC_UPDATE',
  NPC_DEATH = 'NPC_DEATH',
  MAIDEN_CRAB_LEAK = 'MAIDEN_CRAB_LEAK',
  MAIDEN_BLOOD_SPLATS = 'MAIDEN_BLOOD_SPLATS',
  BLOAT_DOWN = 'BLOAT_DOWN',
  BLOAT_UP = 'BLOAT_UP',
  NYLO_WAVE_SPAWN = 'NYLO_WAVE_SPAWN',
  NYLO_WAVE_STALL = 'NYLO_WAVE_STALL',
  NYLO_CLEANUP_END = 'NYLO_CLEANUP_END',
  NYLO_BOSS_SPAWN = 'NYLO_BOSS_SPAWN',
  SOTE_MAZE_PROC = 'SOTE_MAZE_PROC',
  SOTE_MAZE_PATH = 'SOTE_MAZE_PATH',
  VERZIK_PHASE = 'VERZIK_PHASE',
  VERZIK_REDS_SPAWN = 'VERZIK_REDS_SPAWN',
  XARPUS_PHASE = 'XARPUS_PHASE',
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

export interface RaidUpdateEvent extends Event {
  type: EventType.RAID_UPDATE;
  raidInfo: RaidInfo;
}

export interface RoomStatusEvent extends Event {
  type: EventType.ROOM_STATUS;
  roomStatus: RoomStatus;
}

export interface PlayerEvent extends Event {
  player: Player;
}

export interface PlayerUpdateEvent extends PlayerEvent {
  type: EventType.PLAYER_UPDATE;
}

export interface PlayerAttackEvent extends PlayerEvent {
  type: EventType.PLAYER_ATTACK;
  attack: Attack;
}

export interface PlayerDeathEvent extends PlayerEvent {
  type: EventType.PLAYER_UPDATE;
}

export interface NpcSpawnEvent extends Event {
  type: EventType.NPC_SPAWN;
  npc: EventNpc;
}

export interface NpcUpdateEvent extends Event {
  type: EventType.NPC_UPDATE;
  npc: EventNpc;
}

export interface NpcDeathEvent extends Event {
  type: EventType.NPC_DEATH;
  npc: EventNpc;
}

export interface MaidenBloodSplatsEvent extends Event {
  type: EventType.MAIDEN_BLOOD_SPLATS;
  maidenBloodSplats: Coords[];
}

export interface BloatDownEvent extends Event {
  type: EventType.BLOAT_DOWN;
  bloatStatus: BloatStatus;
}

export interface NyloWaveSpawnEvent extends Event {
  type: EventType.NYLO_WAVE_SPAWN;
  nyloWave: NyloWave;
}

export interface NyloWaveStallEvent extends Event {
  type: EventType.NYLO_WAVE_SPAWN;
  nyloWave: NyloWave;
}

export interface SoteMazeProcEvent extends Event {
  type: EventType.NYLO_WAVE_SPAWN;
  soteMaze: SoteMaze;
}

export interface XarpusPhaseEvent extends Event {
  type: EventType.XARPUS_PHASE;
  xarpusPhase: XarpusPhase;
}

export interface VerzikPhaseEvent extends Event {
  type: EventType.VERZIK_PHASE;
  verzikPhase: VerzikPhase;
}

export interface VerzikRedsSpawnEvent extends Event {
  type: EventType.VERZIK_REDS_SPAWN;
  verzikPhase: VerzikPhase;
}

export type RaidInfo = {
  party: string[];
  mode?: Mode;
};

export type Player = {
  name: string;
  offCooldownTick: number;
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
  CAPE = 'CAPE',
  AMULET = 'AMULET',
  AMMO = 'AMMO',
  WEAPON = 'WEAPON',
  TORSO = 'TORSO',
  SHIELD = 'SHIELD',
  LEGS = 'LEGS',
  GLOVES = 'GLOVES',
  BOOTS = 'BOOTS',
  RING = 'RING',
}

export type EquipmentMap = {
  [key in EquipmentSlot]: Item;
};

export interface BasicEventNpc {
  id: number;
  roomId: number;
}

export interface EventNpc extends BasicEventNpc {
  type: RoomNpcType;
  hitpoints: SkillLevel;
  maidenCrab?: MaidenCrabProperties;
  nylo?: NyloProperties;
  verzikCrab?: VerzikCrabProperties;
}

export type Attack = {
  type: PlayerAttack;
  weapon: Item;
  target: BasicEventNpc;
};

export type Coords = {
  x: number;
  y: number;
};

export type BloatStatus = {
  walkTime: number;
};

export type NyloWave = {
  wave: number;
  nylosAlive: number;
  roomCap: number;
};

export type SoteMaze = {
  maze: Maze;
};
