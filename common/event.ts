import {
  ChallengeMode,
  SkillLevel,
  Room,
  RoomStatus,
  PlayerAttack,
  Maze,
  XarpusPhase,
  VerzikPhase,
  RoomNpcType,
  NyloProperties,
  MaidenCrabProperties,
  VerzikCrabProperties,
  NpcAttack,
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
  NPC_ATTACK = 'NPC_ATTACK',
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
  XARPUS_PHASE = 'XARPUS_PHASE',
  VERZIK_PHASE = 'VERZIK_PHASE',
  VERZIK_REDS_SPAWN = 'VERZIK_REDS_SPAWN',
  VERZIK_ATTACK_STYLE = 'VERZIK_ATTACK_STYLE',
}

// Renames:
// - all enums
// - bloatStatus -> bloatDown
//
// Deleted:
// - verzikRedsSpawn

export const isPlayerEvent = (event: Event): boolean => {
  return (
    event.type === EventType.PLAYER_UPDATE ||
    event.type === EventType.PLAYER_ATTACK ||
    event.type === EventType.PLAYER_DEATH
  );
};

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

export interface RaidEndEvent extends Event {
  type: EventType.RAID_END;
  completedRaid: CompletedRaid;
}

export interface RoomStatusEvent extends Event {
  type: EventType.ROOM_STATUS;
  roomStatus: {
    status: RoomStatus;
    accurate: boolean;
  };
}

export interface PlayerEvent extends Event {
  player: BasicPlayer;
}

export interface PlayerUpdateEvent extends PlayerEvent {
  type: EventType.PLAYER_UPDATE;
  player: Player;
}

export interface PlayerAttackEvent extends PlayerEvent {
  type: EventType.PLAYER_ATTACK;
  attack: Attack;
}

export interface PlayerDeathEvent extends PlayerEvent {
  type: EventType.PLAYER_DEATH;
}

export interface NpcEvent extends Event {
  npc: EventNpc;
}

export interface NpcSpawnEvent extends NpcEvent {
  type: EventType.NPC_SPAWN;
}

export interface NpcUpdateEvent extends NpcEvent {
  type: EventType.NPC_UPDATE;
}

export interface NpcDeathEvent extends NpcEvent {
  type: EventType.NPC_DEATH;
}

export interface NpcAttackEvent extends Event {
  type: EventType.NPC_ATTACK;
  npc: BasicEventNpc;
  npcAttack: NpcAttackDesc;
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

export interface VerzikAttackStyleEvent extends Event {
  type: EventType.VERZIK_ATTACK_STYLE;
  verzikAttack: {
    style: VerzikAttackStyle;
    npcAttackTick: number;
  };
}

export type RaidInfo = {
  party: string[];
  mode?: ChallengeMode;
  isSpectator?: boolean;
};

export type CompletedRaid = {
  overallTime: number;
};

export interface BasicPlayer {
  name: string;
}

export interface Player extends BasicPlayer {
  offCooldownTick: number;
  hitpoints?: SkillLevel;
  prayer?: SkillLevel;
  attack?: SkillLevel;
  strength?: SkillLevel;
  defence?: SkillLevel;
  ranged?: SkillLevel;
  magic?: SkillLevel;
  equipment?: EquipmentMap;
}

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
  weapon?: Item;
  target?: BasicEventNpc;
  distanceToTarget: number;
};

export type NpcAttackDesc = {
  /** Style of the attack. */
  attack: NpcAttack;
  /** Username of the player the attack targets. Undefined if no target. */
  target?: string;
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

export enum VerzikAttackStyle {
  MELEE = 'MELEE',
  RANGE = 'RANGE',
  MAGE = 'MAGE',
}
