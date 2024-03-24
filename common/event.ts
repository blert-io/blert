import { Event as EventProto } from './generated/event_pb';
import {
  SkillLevel,
  Room,
  StageStatus,
  PlayerAttack,
  Maze,
  XarpusPhase,
  VerzikPhase,
  RoomNpcType,
  NyloProperties,
  MaidenCrabProperties,
  VerzikCrabProperties,
  NpcAttack,
  Stage,
} from './raid-definitions';

export enum EventType {
  CHALLENGE_START = EventProto.Type.CHALLENGE_START,
  CHALLENGE_END = EventProto.Type.CHALLENGE_END,
  CHALLENGE_UPDATE = EventProto.Type.CHALLENGE_UPDATE,
  STAGE_UPDATE = EventProto.Type.STAGE_UPDATE,
  PLAYER_UPDATE = EventProto.Type.PLAYER_UPDATE,
  PLAYER_ATTACK = EventProto.Type.PLAYER_ATTACK,
  PLAYER_DEATH = EventProto.Type.PLAYER_DEATH,
  NPC_SPAWN = EventProto.Type.NPC_SPAWN,
  NPC_UPDATE = EventProto.Type.NPC_UPDATE,
  NPC_DEATH = EventProto.Type.NPC_DEATH,
  NPC_ATTACK = EventProto.Type.NPC_ATTACK,
  TOB_MAIDEN_CRAB_LEAK = EventProto.Type.TOB_MAIDEN_CRAB_LEAK,
  TOB_MAIDEN_BLOOD_SPLATS = EventProto.Type.TOB_MAIDEN_BLOOD_SPLATS,
  TOB_BLOAT_DOWN = EventProto.Type.TOB_BLOAT_DOWN,
  TOB_BLOAT_UP = EventProto.Type.TOB_BLOAT_UP,
  TOB_NYLO_WAVE_SPAWN = EventProto.Type.TOB_NYLO_WAVE_SPAWN,
  TOB_NYLO_WAVE_STALL = EventProto.Type.TOB_NYLO_WAVE_STALL,
  TOB_NYLO_CLEANUP_END = EventProto.Type.TOB_NYLO_CLEANUP_END,
  TOB_NYLO_BOSS_SPAWN = EventProto.Type.TOB_NYLO_BOSS_SPAWN,
  TOB_SOTE_MAZE_PROC = EventProto.Type.TOB_SOTE_MAZE_PROC,
  TOB_SOTE_MAZE_PATH = EventProto.Type.TOB_SOTE_MAZE_PATH,
  TOB_XARPUS_PHASE = EventProto.Type.TOB_XARPUS_PHASE,
  TOB_VERZIK_PHASE = EventProto.Type.TOB_VERZIK_PHASE,
  TOB_VERZIK_ATTACK_STYLE = EventProto.Type.TOB_VERZIK_ATTACK_STYLE,
}

// Renames:
// - all enums
// - bloatStatus -> bloatDown

export const isPlayerEvent = (event: Event): boolean => {
  return (
    event.type === EventType.PLAYER_UPDATE ||
    event.type === EventType.PLAYER_ATTACK ||
    event.type === EventType.PLAYER_DEATH
  );
};

export interface Event {
  cId: string;
  type: EventType;
  typeString: string; // TODO: delete
  raidId?: string; // TODO: delete
  stage: Stage;
  roomString: string; // TODO: delete
  room?: Room; // TODO: delete
  tick: number;
  xCoord: number;
  yCoord: number;
}

export interface StageUpdateEvent extends Event {
  type: EventType.STAGE_UPDATE;
  stageUpdate: {
    status: StageStatus;
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
  type: EventType.TOB_MAIDEN_BLOOD_SPLATS;
  maidenBloodSplats: Coords[];
}

export interface BloatDownEvent extends Event {
  type: EventType.TOB_BLOAT_DOWN;
  bloatDown: BloatDown;
  bloatStatus: BloatDown; // TODO: delete
}

export interface NyloWaveSpawnEvent extends Event {
  type: EventType.TOB_NYLO_WAVE_SPAWN;
  nyloWave: NyloWave;
}

export interface NyloWaveStallEvent extends Event {
  type: EventType.TOB_NYLO_WAVE_SPAWN;
  nyloWave: NyloWave;
}

export interface SoteMazeProcEvent extends Event {
  type: EventType.TOB_NYLO_WAVE_SPAWN;
  soteMaze: SoteMaze;
}

export interface XarpusPhaseEvent extends Event {
  type: EventType.TOB_XARPUS_PHASE;
  xarpusPhase: XarpusPhase;
  xarpusPhaseString: string; // TODO: delete
}

export interface VerzikPhaseEvent extends Event {
  type: EventType.TOB_VERZIK_PHASE;
  verzikPhase: VerzikPhase;
  verzikPhaseString: string; // TODO: delete
}

export interface VerzikAttackStyleEvent extends Event {
  type: EventType.TOB_VERZIK_ATTACK_STYLE;
  verzikAttack: {
    style: VerzikAttackStyle;
    sylteString: string; // TODO: delete
    npcAttackTick: number;
  };
}

export type MergedEvent = Event &
  Omit<StageUpdateEvent, 'type'> &
  Omit<PlayerUpdateEvent, 'type'> &
  Omit<PlayerAttackEvent, 'type'> &
  Omit<PlayerDeathEvent, 'type'> &
  Omit<NpcSpawnEvent, 'type'> &
  Omit<NpcUpdateEvent, 'type'> &
  Omit<NpcDeathEvent, 'type'> &
  Omit<NpcAttackEvent, 'type'> &
  Omit<MaidenBloodSplatsEvent, 'type'> &
  Omit<BloatDownEvent, 'type'> &
  Omit<NyloWaveSpawnEvent, 'type'> &
  Omit<NyloWaveStallEvent, 'type'> &
  Omit<SoteMazeProcEvent, 'type'> &
  Omit<XarpusPhaseEvent, 'type'> &
  Omit<VerzikPhaseEvent, 'type'> &
  Omit<VerzikAttackStyleEvent, 'type'>;

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
  typeString: string; // TODO: delete
  hitpoints: SkillLevel;
  maidenCrab?: MaidenCrabProperties;
  nylo?: NyloProperties;
  verzikCrab?: VerzikCrabProperties;
}

export type Attack = {
  type: PlayerAttack;
  typeString: string; // TODO: delete
  weapon?: Item;
  target?: BasicEventNpc;
  distanceToTarget: number;
};

export type NpcAttackDesc = {
  /** Style of the attack. */
  attack: NpcAttack;
  attackString: string; // TODO: delete
  /** Username of the player the attack targets. Undefined if no target. */
  target?: string;
};

export type Coords = {
  x: number;
  y: number;
};

export type BloatDown = {
  downNumber: number;
  walkTime: number;
};

export type NyloWave = {
  wave: number;
  nylosAlive: number;
  roomCap: number;
};

export type SoteMaze = {
  maze: Maze;
  mazeString: string; // TODO: delete
};

export enum VerzikAttackStyle {
  MELEE = 'MELEE',
  RANGE = 'RANGE',
  MAGE = 'MAGE',
}
