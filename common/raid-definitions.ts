import { Types } from 'mongoose';

import { Coords } from './event';
import {
  Challenge as ChallengeProto,
  ChallengeMode as ChallengeModeProto,
  Event as EventProto,
  PlayerAttack as PlayerAttackProto,
  NpcAttack as NpcAttackProto,
  Stage as StageProto,
} from './generated/event_pb';

export enum ChallengeType {
  TOB = ChallengeProto.TOB,
  COX = ChallengeProto.COX,
  TOA = ChallengeProto.TOA,
  COLOSSEUM = ChallengeProto.COLOSSEUM,
  INFERNO = ChallengeProto.INFERNO,
}

export type Raid = {
  _id: string;
  type: ChallengeType;
  status: ChallengeStatus;
  stage: Stage;
  mode: ChallengeMode;
  startTime: Date;
  party: string[];
  partyIds: Types.ObjectId[];
  partyInfo: PlayerInfo[];
  totalTicks: number;
  totalDeaths: number;
};

export type TobRaid = Raid & {
  type: ChallengeType.TOB;
  tobRooms: TobRooms;
};

export type ColosseumChallenge = Raid & {
  type: ChallengeType.COLOSSEUM;
  colosseum: ColosseumData;
};

export type TobRooms = {
  maiden: MaidenOverview | null;
  bloat: BloatOverview | null;
  nylocas: NyloOverview | null;
  sotetseg: SoteOverview | null;
  xarpus: XarpusOverview | null;
  verzik: VerzikOverview | null;
};

export type ColosseumData = {
  handicaps: Handicap[];
  waves: ColosseumWave[];
};

export type ColosseumWave = {
  ticks: number;
  handicap: Handicap;
  options: Handicap[];
  npcs: RoomNpcMap;
};

export const HANDICAP_LEVEL_VALUE_INCREMENT = 30;

export enum Handicap {
  DOOM_SCORPION = 0,
  REENTRY = 1,
  BEES = 2,
  VOLATILITY = 3,
  BLASPHEMY = 4,
  RELENTLESS = 5,
  QUARTET = 6,
  TOTEMIC = 7,
  DOOM = 8,
  DYNAMIC_DUO = 9,
  SOLARFLARE = 10,
  MYOPIA = 11,
  FRAILTY = 12,
  RED_FLAG = 13,

  // These are not official handicap IDs (leveled handicaps re-use the same ID)
  // but exist for convenience. Each level's ID adds 30 to the previous level.
  DOOM_SCORPION_2 = DOOM_SCORPION + HANDICAP_LEVEL_VALUE_INCREMENT,
  REENTRY_2 = REENTRY + HANDICAP_LEVEL_VALUE_INCREMENT,
  BEES_2 = BEES + HANDICAP_LEVEL_VALUE_INCREMENT,
  VOLATILITY_2 = VOLATILITY + HANDICAP_LEVEL_VALUE_INCREMENT,
  BLASPHEMY_2 = BLASPHEMY + HANDICAP_LEVEL_VALUE_INCREMENT,
  RELENTLESS_2 = RELENTLESS + HANDICAP_LEVEL_VALUE_INCREMENT,
  SOLARFLARE_2 = SOLARFLARE + HANDICAP_LEVEL_VALUE_INCREMENT,
  MYOPIA_2 = MYOPIA + HANDICAP_LEVEL_VALUE_INCREMENT,
  FRAILTY_2 = FRAILTY + HANDICAP_LEVEL_VALUE_INCREMENT,

  DOOM_SCORPION_3 = DOOM_SCORPION_2 + HANDICAP_LEVEL_VALUE_INCREMENT,
  REENTRY_3 = REENTRY_2 + HANDICAP_LEVEL_VALUE_INCREMENT,
  BEES_3 = BEES_2 + HANDICAP_LEVEL_VALUE_INCREMENT,
  VOLATILITY_3 = VOLATILITY_2 + HANDICAP_LEVEL_VALUE_INCREMENT,
  BLASPHEMY_3 = BLASPHEMY_2 + HANDICAP_LEVEL_VALUE_INCREMENT,
  RELENTLESS_3 = RELENTLESS_2 + HANDICAP_LEVEL_VALUE_INCREMENT,
  SOLARFLARE_3 = SOLARFLARE_2 + HANDICAP_LEVEL_VALUE_INCREMENT,
  MYOPIA_3 = MYOPIA_2 + HANDICAP_LEVEL_VALUE_INCREMENT,
  FRAILTY_3 = FRAILTY_2 + HANDICAP_LEVEL_VALUE_INCREMENT,
}

export type RoomNpcMap = { [roomId: number]: RoomNpc };

export interface RoomOverview {
  firstTick: number;
  roomTicks: number;
  deaths: string[];
  npcs: RoomNpcMap;
}

export interface MaidenOverview extends RoomOverview {
  splits: MaidenSplits;
}

export interface BloatOverview extends RoomOverview {
  splits: BloatSplits;
}

export interface NyloOverview extends RoomOverview {
  splits: NyloSplits;
  stalledWaves: number[];
}

export interface SoteOverview extends RoomOverview {
  splits: SoteSplits;
  maze66?: SoteMazeInfo;
  maze33?: SoteMazeInfo;
}

export interface XarpusOverview extends RoomOverview {
  splits: XarpusSplits;
}

export interface VerzikOverview extends RoomOverview {
  redCrabSpawns: number;
  splits: VerzikSplits;
}

export type MaidenSplits = {
  SEVENTIES: number;
  FIFTIES: number;
  THIRTIES: number;
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
  MAZE_66: number;
  MAZE_33: number;
};

export type SoteMazeInfo = {
  pivots: number[];
  ticks: number;
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

export enum ChallengeStatus {
  IN_PROGRESS = 0,
  COMPLETED = 1,
  RESET = 2,
  WIPED = 3,
}

export enum Stage {
  UNKNOWN = StageProto.UNKNOWN_STAGE,

  TOB_MAIDEN = StageProto.TOB_MAIDEN,
  TOB_BLOAT = StageProto.TOB_BLOAT,
  TOB_NYLOCAS = StageProto.TOB_NYLOCAS,
  TOB_SOTETSEG = StageProto.TOB_SOTETSEG,
  TOB_XARPUS = StageProto.TOB_XARPUS,
  TOB_VERZIK = StageProto.TOB_VERZIK,

  COX_TEKTON = StageProto.COX_TEKTON,
  COX_CRABS = StageProto.COX_CRABS,
  COX_ICE_DEMON = StageProto.COX_ICE_DEMON,
  COX_SHAMANS = StageProto.COX_SHAMANS,
  COX_VANGUARDS = StageProto.COX_VANGUARDS,
  COX_THIEVING = StageProto.COX_THIEVING,
  COX_VESPULA = StageProto.COX_VESPULA,
  COX_TIGHTROPE = StageProto.COX_TIGHTROPE,
  COX_GUARDIANS = StageProto.COX_GUARDIANS,
  COX_VASA = StageProto.COX_VASA,
  COX_MYSTICS = StageProto.COX_MYSTICS,
  COX_MUTTADILE = StageProto.COX_MUTTADILE,
  COX_OLM = StageProto.COX_OLM,

  TOA_APMEKEN = StageProto.TOA_APMEKEN,
  TOA_BABA = StageProto.TOA_BABA,
  TOA_SCABARAS = StageProto.TOA_SCABARAS,
  TOA_KEPHRI = StageProto.TOA_KEPHRI,
  TOA_HET = StageProto.TOA_HET,
  TOA_AKKHA = StageProto.TOA_AKKHA,
  TOA_CRONDIS = StageProto.TOA_CRONDIS,
  TOA_ZEBAK = StageProto.TOA_ZEBAK,
  TOA_WARDENS = StageProto.TOA_WARDENS,

  COLOSSEUM_WAVE_1 = StageProto.COLOSSEUM_WAVE_1,
  COLOSSEUM_WAVE_2 = StageProto.COLOSSEUM_WAVE_2,
  COLOSSEUM_WAVE_3 = StageProto.COLOSSEUM_WAVE_3,
  COLOSSEUM_WAVE_4 = StageProto.COLOSSEUM_WAVE_4,
  COLOSSEUM_WAVE_5 = StageProto.COLOSSEUM_WAVE_5,
  COLOSSEUM_WAVE_6 = StageProto.COLOSSEUM_WAVE_6,
  COLOSSEUM_WAVE_7 = StageProto.COLOSSEUM_WAVE_7,
  COLOSSEUM_WAVE_8 = StageProto.COLOSSEUM_WAVE_8,
  COLOSSEUM_WAVE_9 = StageProto.COLOSSEUM_WAVE_9,
  COLOSSEUM_WAVE_10 = StageProto.COLOSSEUM_WAVE_10,
  COLOSSEUM_WAVE_11 = StageProto.COLOSSEUM_WAVE_11,
  COLOSSEUM_WAVE_12 = StageProto.COLOSSEUM_WAVE_12,
}

export enum ChallengeMode {
  NO_MODE = ChallengeModeProto.NO_MODE,

  TOB_ENTRY = ChallengeModeProto.TOB_ENTRY,
  TOB_REGULAR = ChallengeModeProto.TOB_REGULAR,
  TOB_HARD = ChallengeModeProto.TOB_HARD,
}

export enum StageStatus {
  ENTERED = EventProto.StageUpdate.Status.ENTERED,
  STARTED = EventProto.StageUpdate.Status.STARTED,
  COMPLETED = EventProto.StageUpdate.Status.COMPLETED,
  WIPED = EventProto.StageUpdate.Status.WIPED,
}

export enum RoomNpcType {
  BASIC = 0,
  MAIDEN_CRAB = 1,
  NYLO = 2,
  VERZIK_CRAB = 3,
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

export interface VerzikCrab extends RoomNpc {
  type: RoomNpcType.VERZIK_CRAB;
  verzikCrab: VerzikCrabProperties;
}

export type NyloProperties = {
  /**
   * Room ID of the big nylo which spawned this nylo split, or 0 if this nylo
   * is a spawn.
   */
  parentRoomId: number;

  /** Wave on which the nylo spawned. */
  wave: number;

  /** Whether the nylo is a big. */
  big: boolean;

  /** Attack style of the nylo when it spawned. */
  style: NyloStyle;

  /** Spawn location of the nylo. */
  spawnType: NyloSpawn;
};

export type VerzikCrabProperties = {
  phase: VerzikPhase;
  spawn: VerzikCrabSpawn;
};

export enum Skill {
  HITPOINTS,
  PRAYER,
  ATTACK,
  STRENGTH,
  DEFENCE,
  RANGED,
  MAGIC,
}

export type RawSkillLevel = number;

/**
 * Represents a level in a skill, with a base level and a boosted or drained
 * current level.
 */
export class SkillLevel {
  private current: number;
  private base: number;

  public static fromRaw(raw: RawSkillLevel): SkillLevel {
    const base = raw & 0xffff;
    const current = raw >> 16;
    return new SkillLevel(current, base);
  }

  public constructor(current: number, base: number) {
    this.current = Math.max(current, 0);
    this.base = Math.max(base, 0);
  }

  public getBase(): number {
    return this.base;
  }

  public getCurrent(): number {
    return this.current;
  }

  public toRaw(): RawSkillLevel {
    return (this.current << 16) | (this.base & 0xffff);
  }

  public toString(): string {
    return `${this.current}/${this.base}`;
  }

  public percentage(): number {
    return (this.current / this.base) * 100;
  }

  public toPercent(fractionDigits: number = 2): string {
    return `${this.percentage().toFixed(fractionDigits)}%`;
  }

  public withCurrent(current: number): SkillLevel {
    return new SkillLevel(current, this.base);
  }
}

export enum PlayerAttack {
  BGS_SMACK = PlayerAttackProto.BGS_SMACK,
  BGS_SPEC = PlayerAttackProto.BGS_SPEC,
  BLOWPIPE = PlayerAttackProto.BLOWPIPE,
  BOWFA = PlayerAttackProto.BOWFA,
  CHALLY_SPEC = PlayerAttackProto.CHALLY_SPEC,
  CHALLY_SWIPE = PlayerAttackProto.CHALLY_SWIPE,
  CHIN_BLACK = PlayerAttackProto.CHIN_BLACK,
  CHIN_GREY = PlayerAttackProto.CHIN_GREY,
  CHIN_RED = PlayerAttackProto.CHIN_RED,
  CLAW_SCRATCH = PlayerAttackProto.CLAW_SCRATCH,
  CLAW_SPEC = PlayerAttackProto.CLAW_SPEC,
  DAWN_SPEC = PlayerAttackProto.DAWN_SPEC,
  DINHS_SPEC = PlayerAttackProto.DINHS_SPEC,
  FANG_STAB = PlayerAttackProto.FANG_STAB,
  HAMMER_BOP = PlayerAttackProto.HAMMER_BOP,
  HAMMER_SPEC = PlayerAttackProto.HAMMER_SPEC,
  HAM_JOINT = PlayerAttackProto.HAM_JOINT,
  KODAI_BARRAGE = PlayerAttackProto.KODAI_BARRAGE,
  KODAI_BASH = PlayerAttackProto.KODAI_BASH,
  RAPIER = PlayerAttackProto.RAPIER,
  SAELDOR = PlayerAttackProto.SAELDOR,
  SANG = PlayerAttackProto.SANG,
  SANG_BARRAGE = PlayerAttackProto.SANG_BARRAGE,
  SCEPTRE_BARRAGE = PlayerAttackProto.SCEPTRE_BARRAGE,
  SCYTHE = PlayerAttackProto.SCYTHE,
  SCYTHE_UNCHARGED = PlayerAttackProto.SCYTHE_UNCHARGED,
  SGS_SMACK = PlayerAttackProto.SGS_SMACK,
  SGS_SPEC = PlayerAttackProto.SGS_SPEC,
  SHADOW = PlayerAttackProto.SHADOW,
  SHADOW_BARRAGE = PlayerAttackProto.SHADOW_BARRAGE,
  SOTD_BARRAGE = PlayerAttackProto.SOTD_BARRAGE,
  SOULREAPER_AXE = PlayerAttackProto.SOULREAPER_AXE,
  STAFF_OF_LIGHT_BARRAGE = PlayerAttackProto.STAFF_OF_LIGHT_BARRAGE,
  STAFF_OF_LIGHT_SWIPE = PlayerAttackProto.STAFF_OF_LIGHT_SWIPE,
  SWIFT_BLADE = PlayerAttackProto.SWIFT_BLADE,
  TENT_WHIP = PlayerAttackProto.TENT_WHIP,
  TOXIC_TRIDENT = PlayerAttackProto.TOXIC_TRIDENT,
  TOXIC_TRIDENT_BARRAGE = PlayerAttackProto.TOXIC_TRIDENT_BARRAGE,
  TOXIC_STAFF_BARRAGE = PlayerAttackProto.TOXIC_STAFF_BARRAGE,
  TOXIC_STAFF_SWIPE = PlayerAttackProto.TOXIC_STAFF_SWIPE,
  TRIDENT = PlayerAttackProto.TRIDENT,
  TRIDENT_BARRAGE = PlayerAttackProto.TRIDENT_BARRAGE,
  TWISTED_BOW = PlayerAttackProto.TWISTED_BOW,
  VENATOR_BOW = PlayerAttackProto.VENATOR_BOW,
  VOLATILE_NM_BARRAGE = PlayerAttackProto.VOLATILE_NM_BARRAGE,
  ZCB_SPEC = PlayerAttackProto.ZCB_SPEC,

  UNKNOWN_BARRAGE = PlayerAttackProto.UNKNOWN_BARRAGE,
  UNKNOWN_BOW = PlayerAttackProto.UNKNOWN_BOW,
  UNKNOWN_POWERED_STAFF = PlayerAttackProto.UNKNOWN_POWERED_STAFF,
  UNKNOWN = PlayerAttackProto.UNKNOWN,
}

export enum NpcAttack {
  UNKNOWN = NpcAttackProto.UNKNOWN_NPC_ATTACK,

  TOB_MAIDEN_AUTO = NpcAttackProto.TOB_MAIDEN_AUTO,
  TOB_MAIDEN_BLOOD_THROW = NpcAttackProto.TOB_MAIDEN_BLOOD_THROW,
  TOB_BLOAT_STOMP = NpcAttackProto.TOB_BLOAT_STOMP,
  TOB_NYLO_BOSS_MELEE = NpcAttackProto.TOB_NYLO_BOSS_MELEE,
  TOB_NYLO_BOSS_RANGE = NpcAttackProto.TOB_NYLO_BOSS_RANGE,
  TOB_NYLO_BOSS_MAGE = NpcAttackProto.TOB_NYLO_BOSS_MAGE,
  TOB_SOTE_MELEE = NpcAttackProto.TOB_SOTE_MELEE,
  TOB_SOTE_BALL = NpcAttackProto.TOB_SOTE_BALL,
  TOB_SOTE_DEATH_BALL = NpcAttackProto.TOB_SOTE_DEATH_BALL,
  TOB_XARPUS_SPIT = NpcAttackProto.TOB_XARPUS_SPIT,
  TOB_XARPUS_TURN = NpcAttackProto.TOB_XARPUS_TURN,
  TOB_VERZIK_P1_AUTO = NpcAttackProto.TOB_VERZIK_P1_AUTO,
  TOB_VERZIK_P2_BOUNCE = NpcAttackProto.TOB_VERZIK_P2_BOUNCE,
  TOB_VERZIK_P2_CABBAGE = NpcAttackProto.TOB_VERZIK_P2_CABBAGE,
  TOB_VERZIK_P2_ZAP = NpcAttackProto.TOB_VERZIK_P2_ZAP,
  TOB_VERZIK_P2_PURPLE = NpcAttackProto.TOB_VERZIK_P2_PURPLE,
  TOB_VERZIK_P2_MAGE = NpcAttackProto.TOB_VERZIK_P2_MAGE,
  TOB_VERZIK_P3_AUTO = NpcAttackProto.TOB_VERZIK_P3_AUTO,
  TOB_VERZIK_P3_MELEE = NpcAttackProto.TOB_VERZIK_P3_MELEE,
  TOB_VERZIK_P3_RANGE = NpcAttackProto.TOB_VERZIK_P3_RANGE,
  TOB_VERZIK_P3_MAGE = NpcAttackProto.TOB_VERZIK_P3_MAGE,
  TOB_VERZIK_P3_WEBS = NpcAttackProto.TOB_VERZIK_P3_WEBS,
  TOB_VERZIK_P3_YELLOWS = NpcAttackProto.TOB_VERZIK_P3_YELLOWS,
  TOB_VERZIK_P3_BALL = NpcAttackProto.TOB_VERZIK_P3_BALL,

  COLOSSEUM_BERSERKER_AUTO = NpcAttackProto.COLOSSEUM_BERSERKER_AUTO,
  COLOSSEUM_SEER_AUTO = NpcAttackProto.COLOSSEUM_SEER_AUTO,
  COLOSSEUM_ARCHER_AUTO = NpcAttackProto.COLOSSEUM_ARCHER_AUTO,
  COLOSSEUM_SHAMAN_AUTO = NpcAttackProto.COLOSSEUM_SHAMAN_AUTO,
  COLOSSEUM_JAGUAR_AUTO = NpcAttackProto.COLOSSEUM_JAGUAR_AUTO,
  COLOSSEUM_JAVELIN_AUTO = NpcAttackProto.COLOSSEUM_JAVELIN_AUTO,
  COLOSSEUM_JAVELIN_TOSS = NpcAttackProto.COLOSSEUM_JAVELIN_TOSS,
  COLOSSEUM_MANTICORE_MAGE = NpcAttackProto.COLOSSEUM_MANTICORE_MAGE,
  COLOSSEUM_MANTICORE_RANGE = NpcAttackProto.COLOSSEUM_MANTICORE_RANGE,
  COLOSSEUM_MANTICORE_MELEE = NpcAttackProto.COLOSSEUM_MANTICORE_MELEE,
  COLOSSEUM_SHOCKWAVE_AUTO = NpcAttackProto.COLOSSEUM_SHOCKWAVE_AUTO,
  COLOSSEUM_MINOTAUR_AUTO = NpcAttackProto.COLOSSEUM_MINOTAUR_AUTO,
  COLOSSEUM_HEREDIT_THRUST = NpcAttackProto.COLOSSEUM_HEREDIT_THRUST,
  COLOSSEUM_HEREDIT_SLAM = NpcAttackProto.COLOSSEUM_HEREDIT_SLAM,
  COLOSSEUM_HEREDIT_BREAK = NpcAttackProto.COLOSSEUM_HEREDIT_BREAK,
  COLOSSEUM_HEREDIT_COMBO = NpcAttackProto.COLOSSEUM_HEREDIT_COMBO,
}

export enum MaidenCrabSpawn {
  SEVENTIES = EventProto.Npc.MaidenCrab.Spawn.SEVENTIES,
  FIFTIES = EventProto.Npc.MaidenCrab.Spawn.FIFTIES,
  THIRTIES = EventProto.Npc.MaidenCrab.Spawn.THIRTIES,
}

export enum MaidenCrabPosition {
  N1 = EventProto.Npc.MaidenCrab.Position.N1,
  N2 = EventProto.Npc.MaidenCrab.Position.N2,
  N3 = EventProto.Npc.MaidenCrab.Position.N3,
  N4_INNER = EventProto.Npc.MaidenCrab.Position.N4_INNER,
  N4_OUTER = EventProto.Npc.MaidenCrab.Position.N4_OUTER,
  S1 = EventProto.Npc.MaidenCrab.Position.S1,
  S2 = EventProto.Npc.MaidenCrab.Position.S2,
  S3 = EventProto.Npc.MaidenCrab.Position.S3,
  S4_INNER = EventProto.Npc.MaidenCrab.Position.S4_INNER,
  S4_OUTER = EventProto.Npc.MaidenCrab.Position.S4_OUTER,
}

export enum NyloStyle {
  MELEE = EventProto.Npc.Nylo.Style.MELEE,
  RANGE = EventProto.Npc.Nylo.Style.RANGE,
  MAGE = EventProto.Npc.Nylo.Style.MAGE,
}

export enum NyloSpawn {
  EAST = EventProto.Npc.Nylo.SpawnType.EAST,
  SOUTH = EventProto.Npc.Nylo.SpawnType.SOUTH,
  WEST = EventProto.Npc.Nylo.SpawnType.WEST,
  SPLIT = EventProto.Npc.Nylo.SpawnType.SPLIT,
}

export enum VerzikCrabSpawn {
  UNKNOWN = EventProto.Npc.VerzikCrab.Spawn.UNKNOWN,
  NORTH = EventProto.Npc.VerzikCrab.Spawn.NORTH,
  NORTHEAST = EventProto.Npc.VerzikCrab.Spawn.NORTHEAST,
  NORTHWEST = EventProto.Npc.VerzikCrab.Spawn.NORTHWEST,
  EAST = EventProto.Npc.VerzikCrab.Spawn.EAST,
  SOUTH = EventProto.Npc.VerzikCrab.Spawn.SOUTH,
  SOUTHEAST = EventProto.Npc.VerzikCrab.Spawn.SOUTHEAST,
  SOUTHWEST = EventProto.Npc.VerzikCrab.Spawn.SOUTHWEST,
  WEST = EventProto.Npc.VerzikCrab.Spawn.WEST,
}

export enum Maze {
  MAZE_66 = EventProto.SoteMaze.Maze.MAZE_66,
  MAZE_33 = EventProto.SoteMaze.Maze.MAZE_33,
}

export enum XarpusPhase {
  /** Exhumes */
  P1 = EventProto.XarpusPhase.XARPUS_P1,
  /** Spitting acid */
  P2 = EventProto.XarpusPhase.XARPUS_P2,
  /** Post screech staring */
  P3 = EventProto.XarpusPhase.XARPUS_P3,
}

export enum VerzikPhase {
  IDLE = EventProto.VerzikPhase.VERZIK_IDLE,
  P1 = EventProto.VerzikPhase.VERZIK_P1,
  P2 = EventProto.VerzikPhase.VERZIK_P2,
  P3 = EventProto.VerzikPhase.VERZIK_P3,
}

export enum PrimaryMeleeGear {
  ELITE_VOID,
  BANDOS,
  TORVA,
  BLORVA,
}

export type PlayerInfo = {
  currentUsername: string;
  gear: PrimaryMeleeGear;
};
