import { BlertChartFormat } from '@blert/bcf';
import {
  Attack,
  Challenge,
  Coords,
  EquipmentSlot,
  Event,
  MaidenCrabProperties,
  NpcAttackAction,
  NyloProperties,
  PlayerUpdateEvent,
  PrayerSet,
  RoomNpc,
  Skill,
  SkillLevel,
  Spell,
  VerzikCrabProperties,
} from '@blert/common';

export type Nullable<T> = T | null;

export type Item = {
  id: number;
  name: string;
  quantity: number;
};

export type PlayerEquipment = Record<EquipmentSlot, Item | null>;

export type PlayerState = Omit<PlayerUpdateEvent, 'type' | 'stage'> & {
  attack?: Attack & { damage?: number };
  spell?: Spell;
  diedThisTick: boolean;
  isDead: boolean;
  equipment: PlayerEquipment;
  skills: Partial<Record<Skill, SkillLevel>>;
  customState: CustomPlayerState[];
};

export type CustomPlayerState = {
  label: string;
  fullText?: string;
  icon?: string;
};

export type NpcState = {
  attack: Nullable<NpcAttackAction>;
  position: Coords;
  hitpoints: SkillLevel;
  prayers: PrayerSet;
  id: number;
  label?: string;
};

export type EnhancedRoomNpc = RoomNpc & {
  stateByTick: Nullable<NpcState>[];
  relevant: boolean;
};

export type EnhancedMaidenCrab = EnhancedRoomNpc & {
  maidenCrab: MaidenCrabProperties;
};

export type EnhancedNylo = EnhancedRoomNpc & {
  nylo: NyloProperties;
};

export type EnhancedVerzikCrab = EnhancedRoomNpc & {
  verzikCrab: VerzikCrabProperties;
};

export type EventTickMap = Record<number, Event[]>;
export type EventTypeMap = Record<string, Event[]>;
export type PlayerStateMap = Map<string, Nullable<PlayerState>[]>;
export type RoomNpcMap = Map<number, EnhancedRoomNpc>;

export type EventState = {
  eventsByTick: EventTickMap;
  eventsByType: EventTypeMap;
  playerState: PlayerStateMap;
  npcState: RoomNpcMap;
  bcf: BlertChartFormat;
};

export type StageState<T extends Challenge> = EventState & {
  challenge: T | null;
  events: Event[];
  totalTicks: number;
  loading: boolean;
  isLive: boolean;
  /** Whether the live stage is actively producing events. */
  isStreaming: boolean;
};
