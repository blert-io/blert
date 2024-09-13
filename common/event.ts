import { Event as EventProto } from './generated/event_pb';
import { RawItemDelta } from './item-delta';
import { RawPrayerSet } from './prayer-set';
import {
  Handicap,
  Maze,
  NpcAttack,
  PlayerAttack,
  RawSkillLevel,
  Stage,
  VerzikPhase,
  XarpusPhase,
} from './challenge';

export enum EventType {
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
  TOB_SOTE_MAZE_END = EventProto.Type.TOB_SOTE_MAZE_END,
  TOB_XARPUS_PHASE = EventProto.Type.TOB_XARPUS_PHASE,
  TOB_VERZIK_PHASE = EventProto.Type.TOB_VERZIK_PHASE,
  TOB_VERZIK_ATTACK_STYLE = EventProto.Type.TOB_VERZIK_ATTACK_STYLE,
  COLOSSEUM_HANDICAP_CHOICE = EventProto.Type.COLOSSEUM_HANDICAP_CHOICE,
}

export const isPlayerEvent = (event: Event): event is PlayerEvent => {
  return (
    event.type === EventType.PLAYER_UPDATE ||
    event.type === EventType.PLAYER_ATTACK ||
    event.type === EventType.PLAYER_DEATH
  );
};

export const isNpcEvent = (event: Event): event is NpcEvent => {
  return (
    event.type === EventType.NPC_SPAWN ||
    event.type === EventType.NPC_UPDATE ||
    event.type === EventType.NPC_DEATH
  );
};

export interface Event {
  cId: string;
  type: EventType;
  stage: Stage;
  tick: number;
  xCoord: number;
  yCoord: number;
  acc?: boolean;
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
}

export interface NyloWaveSpawnEvent extends Event {
  type: EventType.TOB_NYLO_WAVE_SPAWN;
  nyloWave: NyloWave;
}

export interface NyloWaveStallEvent extends Event {
  type: EventType.TOB_NYLO_WAVE_STALL;
  nyloWave: NyloWave;
}

export interface SoteMazeEvent extends Event {
  type: EventType.TOB_SOTE_MAZE_PROC | EventType.TOB_SOTE_MAZE_END;
  soteMaze: SoteMaze;
}

export interface SoteMazePathEvent extends Event {
  type: EventType.TOB_SOTE_MAZE_PATH;
  soteMaze: SoteMazePath;
}

export interface XarpusPhaseEvent extends Event {
  type: EventType.TOB_XARPUS_PHASE;
  xarpusPhase: XarpusPhase;
}

export interface VerzikPhaseEvent extends Event {
  type: EventType.TOB_VERZIK_PHASE;
  verzikPhase: VerzikPhase;
}

export interface VerzikAttackStyleEvent extends Event {
  type: EventType.TOB_VERZIK_ATTACK_STYLE;
  verzikAttack: {
    style: VerzikAttackStyle;
    npcAttackTick: number;
  };
}

export interface HandicapChoiceEvent extends Event {
  type: EventType.COLOSSEUM_HANDICAP_CHOICE;
  handicap: Handicap;
}

export type MergedEvent = Event &
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
  Omit<SoteMazePathEvent, 'type'> &
  Omit<XarpusPhaseEvent, 'type'> &
  Omit<VerzikPhaseEvent, 'type'> &
  Omit<VerzikAttackStyleEvent, 'type'> &
  Omit<HandicapChoiceEvent, 'type'>;

export enum DataSource {
  PRIMARY = EventProto.Player.DataSource.PRIMARY,
  SECONDARY = EventProto.Player.DataSource.SECONDARY,
}

export interface BasicPlayer {
  name: string;
}

export interface Player extends BasicPlayer {
  source: DataSource;
  offCooldownTick: number;
  hitpoints?: RawSkillLevel;
  prayer?: RawSkillLevel;
  attack?: RawSkillLevel;
  strength?: RawSkillLevel;
  defence?: RawSkillLevel;
  ranged?: RawSkillLevel;
  magic?: RawSkillLevel;
  prayerSet: RawPrayerSet;
  equipmentDeltas?: RawItemDelta[];
}

export type Item = {
  id: number;
  name: string;
  quantity: number;
};

export enum EquipmentSlot {
  HEAD = EventProto.Player.EquipmentSlot.HEAD,
  CAPE = EventProto.Player.EquipmentSlot.CAPE,
  AMULET = EventProto.Player.EquipmentSlot.AMULET,
  AMMO = EventProto.Player.EquipmentSlot.AMMO,
  WEAPON = EventProto.Player.EquipmentSlot.WEAPON,
  TORSO = EventProto.Player.EquipmentSlot.TORSO,
  SHIELD = EventProto.Player.EquipmentSlot.SHIELD,
  LEGS = EventProto.Player.EquipmentSlot.LEGS,
  GLOVES = EventProto.Player.EquipmentSlot.GLOVES,
  BOOTS = EventProto.Player.EquipmentSlot.BOOTS,
  RING = EventProto.Player.EquipmentSlot.RING,
}

export interface BasicEventNpc {
  id: number;
  roomId: number;
}

export interface EventNpc extends BasicEventNpc {
  hitpoints: RawSkillLevel;
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
};

export type SoteMazePath = SoteMaze & { activeTiles: Coords[] };

export enum VerzikAttackStyle {
  MELEE = EventProto.VerzikAttackStyle.Style.MELEE,
  RANGE = EventProto.VerzikAttackStyle.Style.RANGE,
  MAGE = EventProto.VerzikAttackStyle.Style.MAGE,
}
