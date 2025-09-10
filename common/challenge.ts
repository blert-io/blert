import { Coords } from './event';
import {
  Challenge as ChallengeProto,
  ChallengeMode as ChallengeModeProto,
  Event as EventProto,
  PlayerAttack as PlayerAttackProto,
  NpcAttack as NpcAttackProto,
  Stage as StageProto,
} from './generated/event_pb';
import { SplitType } from './split';

type Nullable<T> = T | null;

export enum ChallengeType {
  TOB = ChallengeProto.TOB,
  COX = ChallengeProto.COX,
  TOA = ChallengeProto.TOA,
  COLOSSEUM = ChallengeProto.COLOSSEUM,
  INFERNO = ChallengeProto.INFERNO,
  MOKHAIOTL = ChallengeProto.MOKHAIOTL,
}

export interface Challenge {
  uuid: string;
  sessionUuid: string;
  type: ChallengeType;
  status: ChallengeStatus;
  stage: Stage;
  mode: ChallengeMode;
  scale: number;
  startTime: Date;
  finishTime: Date | null;
  party: ChallengePlayer[];
  challengeTicks: number;
  overallTicks: number | null;
  totalDeaths: number;
  splits: Partial<Record<SplitType, number>>;
}

export type ChallengePlayer = {
  username: string;
  currentUsername: string;
  primaryGear: PrimaryMeleeGear;
  deaths: Stage[];
};

export interface TobRaid extends Challenge {
  type: ChallengeType.TOB;
  tobRooms: TobRooms;
  tobStats: TobChallengeStats;
}

export interface ColosseumChallenge extends Challenge {
  type: ChallengeType.COLOSSEUM;
  colosseum: ColosseumData;
}

export interface InfernoChallenge extends Challenge {
  type: ChallengeType.INFERNO;
  inferno: InfernoData;
  infernoStats: InfernoChallengeStats;
}

export type InfernoChallengeStats = {
  wastPillarCollapseWave: number | null;
  eastPillarCollapseWave: number | null;
  southPillarCollapseWave: number | null;
  meleerDigs: number;
  magerRevives: number;
};

export interface MokhaiotlChallenge extends Challenge {
  type: ChallengeType.MOKHAIOTL;
  mokhaiotl: MokhaiotlData;
  mokhaiotlStats: MokhaiotlChallengeStats;
}

export type MokhaiotlChallengeStats = {
  delve: number;
  maxCompletedDelve: number;
  larvaeLeaked: number;
};

interface StageData {
  stage: Stage;
  ticksLost: number;
  npcs: RoomNpcMap;
}

export type TobRooms = {
  maiden: Nullable<TobRoom>;
  bloat: Nullable<TobRoom & { downTicks: number[] }>;
  nylocas: Nullable<TobRoom & { stalledWaves: number[] }>;
  sotetseg: Nullable<
    TobRoom & {
      maze1Pivots: number[];
      maze2Pivots: number[];
      maze1Chosen: string | null;
      maze2Chosen: string | null;
    }
  >;
  xarpus: Nullable<TobRoom>;
  verzik: Nullable<TobRoom & { redsSpawnCount: number }>;
};

export type TobChallengeStats = {
  maidenDeaths: number;
  maidenFullLeaks: number | null;
  maidenScuffedSpawns: boolean;
  bloatDeaths: number;
  bloatFirstDownHpPercent: number | null;
  nylocasDeaths: number;
  nylocasPreCapStalls: number | null;
  nylocasPostCapStalls: number | null;
  nylocasStalls: number[];
  nylocasMageSplits: number;
  nylocasRangedSplits: number;
  nylocasMeleeSplits: number;
  nylocasBossMage: number;
  nylocasBossRanged: number;
  nylocasBossMelee: number;
  sotetsegDeaths: number;
  xarpusDeaths: number;
  xarpusHealing: number | null;
  verzikDeaths: number;
  verzikRedsCount: number | null;
};

export interface TobRoom extends StageData {
  deaths: string[];
}

export type ColosseumData = {
  handicaps: Handicap[];
  waves: ColosseumWave[];
};

export interface ColosseumWave extends StageData {
  handicap: Handicap;
  options: Handicap[];
}

export const HANDICAP_LEVEL_VALUE_INCREMENT = 30;

export enum Handicap {
  MANTIMAYHEM = 0,
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
  MANTIMAYHEM_2 = MANTIMAYHEM + HANDICAP_LEVEL_VALUE_INCREMENT,
  REENTRY_2 = REENTRY + HANDICAP_LEVEL_VALUE_INCREMENT,
  BEES_2 = BEES + HANDICAP_LEVEL_VALUE_INCREMENT,
  VOLATILITY_2 = VOLATILITY + HANDICAP_LEVEL_VALUE_INCREMENT,
  BLASPHEMY_2 = BLASPHEMY + HANDICAP_LEVEL_VALUE_INCREMENT,
  RELENTLESS_2 = RELENTLESS + HANDICAP_LEVEL_VALUE_INCREMENT,
  DOOM_2 = DOOM + HANDICAP_LEVEL_VALUE_INCREMENT,
  SOLARFLARE_2 = SOLARFLARE + HANDICAP_LEVEL_VALUE_INCREMENT,
  MYOPIA_2 = MYOPIA + HANDICAP_LEVEL_VALUE_INCREMENT,
  FRAILTY_2 = FRAILTY + HANDICAP_LEVEL_VALUE_INCREMENT,

  MANTIMAYHEM_3 = MANTIMAYHEM_2 + HANDICAP_LEVEL_VALUE_INCREMENT,
  REENTRY_3 = REENTRY_2 + HANDICAP_LEVEL_VALUE_INCREMENT,
  BEES_3 = BEES_2 + HANDICAP_LEVEL_VALUE_INCREMENT,
  VOLATILITY_3 = VOLATILITY_2 + HANDICAP_LEVEL_VALUE_INCREMENT,
  BLASPHEMY_3 = BLASPHEMY_2 + HANDICAP_LEVEL_VALUE_INCREMENT,
  RELENTLESS_3 = RELENTLESS_2 + HANDICAP_LEVEL_VALUE_INCREMENT,
  DOOM_3 = DOOM_2 + HANDICAP_LEVEL_VALUE_INCREMENT,
  SOLARFLARE_3 = SOLARFLARE_2 + HANDICAP_LEVEL_VALUE_INCREMENT,
  MYOPIA_3 = MYOPIA_2 + HANDICAP_LEVEL_VALUE_INCREMENT,
  FRAILTY_3 = FRAILTY_2 + HANDICAP_LEVEL_VALUE_INCREMENT,
}

export type InfernoData = {
  waves: InfernoWave[];
};

export interface InfernoWave extends StageData {
  ticks: number;
  startTick: number;
}

export type MokhaiotlData = {
  delves: MokhaiotlDelve[];
};

export interface MokhaiotlDelve extends StageData {
  /**
   * The delve number, starting from 1.
   * For 1-8, this is equivalent to the stage number.
   * Beyond that, stage is always MOKHAIOTL_DELVE_8PLUS and delve represents
   * the actual delve number.
   */
  delve: number;
  challengeTicks: number;
  larvaeLeaked: number;
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
  ABANDONED = 4,
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

  MOKHAIOTL_DELVE_1 = StageProto.MOKHAIOTL_DELVE_1,
  MOKHAIOTL_DELVE_2 = StageProto.MOKHAIOTL_DELVE_2,
  MOKHAIOTL_DELVE_3 = StageProto.MOKHAIOTL_DELVE_3,
  MOKHAIOTL_DELVE_4 = StageProto.MOKHAIOTL_DELVE_4,
  MOKHAIOTL_DELVE_5 = StageProto.MOKHAIOTL_DELVE_5,
  MOKHAIOTL_DELVE_6 = StageProto.MOKHAIOTL_DELVE_6,
  MOKHAIOTL_DELVE_7 = StageProto.MOKHAIOTL_DELVE_7,
  MOKHAIOTL_DELVE_8 = StageProto.MOKHAIOTL_DELVE_8,
  MOKHAIOTL_DELVE_8PLUS = StageProto.MOKHAIOTL_DELVE_8PLUS,

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

  INFERNO_WAVE_1 = StageProto.INFERNO_WAVE_1,
  INFERNO_WAVE_2 = StageProto.INFERNO_WAVE_2,
  INFERNO_WAVE_3 = StageProto.INFERNO_WAVE_3,
  INFERNO_WAVE_4 = StageProto.INFERNO_WAVE_4,
  INFERNO_WAVE_5 = StageProto.INFERNO_WAVE_5,
  INFERNO_WAVE_6 = StageProto.INFERNO_WAVE_6,
  INFERNO_WAVE_7 = StageProto.INFERNO_WAVE_7,
  INFERNO_WAVE_8 = StageProto.INFERNO_WAVE_8,
  INFERNO_WAVE_9 = StageProto.INFERNO_WAVE_9,
  INFERNO_WAVE_10 = StageProto.INFERNO_WAVE_10,
  INFERNO_WAVE_11 = StageProto.INFERNO_WAVE_11,
  INFERNO_WAVE_12 = StageProto.INFERNO_WAVE_12,
  INFERNO_WAVE_13 = StageProto.INFERNO_WAVE_13,
  INFERNO_WAVE_14 = StageProto.INFERNO_WAVE_14,
  INFERNO_WAVE_15 = StageProto.INFERNO_WAVE_15,
  INFERNO_WAVE_16 = StageProto.INFERNO_WAVE_16,
  INFERNO_WAVE_17 = StageProto.INFERNO_WAVE_17,
  INFERNO_WAVE_18 = StageProto.INFERNO_WAVE_18,
  INFERNO_WAVE_19 = StageProto.INFERNO_WAVE_19,
  INFERNO_WAVE_20 = StageProto.INFERNO_WAVE_20,
  INFERNO_WAVE_21 = StageProto.INFERNO_WAVE_21,
  INFERNO_WAVE_22 = StageProto.INFERNO_WAVE_22,
  INFERNO_WAVE_23 = StageProto.INFERNO_WAVE_23,
  INFERNO_WAVE_24 = StageProto.INFERNO_WAVE_24,
  INFERNO_WAVE_25 = StageProto.INFERNO_WAVE_25,
  INFERNO_WAVE_26 = StageProto.INFERNO_WAVE_26,
  INFERNO_WAVE_27 = StageProto.INFERNO_WAVE_27,
  INFERNO_WAVE_28 = StageProto.INFERNO_WAVE_28,
  INFERNO_WAVE_29 = StageProto.INFERNO_WAVE_29,
  INFERNO_WAVE_30 = StageProto.INFERNO_WAVE_30,
  INFERNO_WAVE_31 = StageProto.INFERNO_WAVE_31,
  INFERNO_WAVE_32 = StageProto.INFERNO_WAVE_32,
  INFERNO_WAVE_33 = StageProto.INFERNO_WAVE_33,
  INFERNO_WAVE_34 = StageProto.INFERNO_WAVE_34,
  INFERNO_WAVE_35 = StageProto.INFERNO_WAVE_35,
  INFERNO_WAVE_36 = StageProto.INFERNO_WAVE_36,
  INFERNO_WAVE_37 = StageProto.INFERNO_WAVE_37,
  INFERNO_WAVE_38 = StageProto.INFERNO_WAVE_38,
  INFERNO_WAVE_39 = StageProto.INFERNO_WAVE_39,
  INFERNO_WAVE_40 = StageProto.INFERNO_WAVE_40,
  INFERNO_WAVE_41 = StageProto.INFERNO_WAVE_41,
  INFERNO_WAVE_42 = StageProto.INFERNO_WAVE_42,
  INFERNO_WAVE_43 = StageProto.INFERNO_WAVE_43,
  INFERNO_WAVE_44 = StageProto.INFERNO_WAVE_44,
  INFERNO_WAVE_45 = StageProto.INFERNO_WAVE_45,
  INFERNO_WAVE_46 = StageProto.INFERNO_WAVE_46,
  INFERNO_WAVE_47 = StageProto.INFERNO_WAVE_47,
  INFERNO_WAVE_48 = StageProto.INFERNO_WAVE_48,
  INFERNO_WAVE_49 = StageProto.INFERNO_WAVE_49,
  INFERNO_WAVE_50 = StageProto.INFERNO_WAVE_50,
  INFERNO_WAVE_51 = StageProto.INFERNO_WAVE_51,
  INFERNO_WAVE_52 = StageProto.INFERNO_WAVE_52,
  INFERNO_WAVE_53 = StageProto.INFERNO_WAVE_53,
  INFERNO_WAVE_54 = StageProto.INFERNO_WAVE_54,
  INFERNO_WAVE_55 = StageProto.INFERNO_WAVE_55,
  INFERNO_WAVE_56 = StageProto.INFERNO_WAVE_56,
  INFERNO_WAVE_57 = StageProto.INFERNO_WAVE_57,
  INFERNO_WAVE_58 = StageProto.INFERNO_WAVE_58,
  INFERNO_WAVE_59 = StageProto.INFERNO_WAVE_59,
  INFERNO_WAVE_60 = StageProto.INFERNO_WAVE_60,
  INFERNO_WAVE_61 = StageProto.INFERNO_WAVE_61,
  INFERNO_WAVE_62 = StageProto.INFERNO_WAVE_62,
  INFERNO_WAVE_63 = StageProto.INFERNO_WAVE_63,
  INFERNO_WAVE_64 = StageProto.INFERNO_WAVE_64,
  INFERNO_WAVE_65 = StageProto.INFERNO_WAVE_65,
  INFERNO_WAVE_66 = StageProto.INFERNO_WAVE_66,
  INFERNO_WAVE_67 = StageProto.INFERNO_WAVE_67,
  INFERNO_WAVE_68 = StageProto.INFERNO_WAVE_68,
  INFERNO_WAVE_69 = StageProto.INFERNO_WAVE_69,
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

export interface Nylo extends RoomNpc {
  type: RoomNpcType.NYLO;
  nylo: NyloProperties;
}

export interface VerzikCrab extends RoomNpc {
  type: RoomNpcType.VERZIK_CRAB;
  verzikCrab: VerzikCrabProperties;
}

export type MaidenCrabProperties = {
  spawn: MaidenCrabSpawn;
  position: MaidenCrabPosition;
  scuffed: boolean;
};

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
  OVERALL = 0,
  ATTACK = 1,
  DEFENCE = 2,
  STRENGTH = 3,
  HITPOINTS = 4,
  RANGED = 5,
  PRAYER = 6,
  MAGIC = 7,
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
  ABYSSAL_BLUDGEON = PlayerAttackProto.ABYSSAL_BLUDGEON,
  ACCURSED_SCEPTRE_AUTO = PlayerAttackProto.ACCURSED_SCEPTRE_AUTO,
  ACCURSED_SCEPTRE_SPEC = PlayerAttackProto.ACCURSED_SCEPTRE_SPEC,
  AGS_SPEC = PlayerAttackProto.AGS_SPEC,
  ARCLIGHT_AUTO = PlayerAttackProto.ARCLIGHT_AUTO,
  ARCLIGHT_SPEC = PlayerAttackProto.ARCLIGHT_SPEC,
  ATLATL_AUTO = PlayerAttackProto.ATLATL_AUTO,
  ATLATL_SPEC = PlayerAttackProto.ATLATL_SPEC,
  BGS_SPEC = PlayerAttackProto.BGS_SPEC,
  BLOWPIPE = PlayerAttackProto.BLOWPIPE,
  BLOWPIPE_SPEC = PlayerAttackProto.BLOWPIPE_SPEC,
  BURNING_CLAW_SCRATCH = PlayerAttackProto.BURNING_CLAW_SCRATCH,
  BURNING_CLAW_SPEC = PlayerAttackProto.BURNING_CLAW_SPEC,
  BOWFA = PlayerAttackProto.BOWFA,
  CHALLY_SPEC = PlayerAttackProto.CHALLY_SPEC,
  CHALLY_SWIPE = PlayerAttackProto.CHALLY_SWIPE,
  CHIN_BLACK = PlayerAttackProto.CHIN_BLACK,
  CHIN_GREY = PlayerAttackProto.CHIN_GREY,
  CHIN_RED = PlayerAttackProto.CHIN_RED,
  CLAW_SCRATCH = PlayerAttackProto.CLAW_SCRATCH,
  CLAW_SPEC = PlayerAttackProto.CLAW_SPEC,
  DARK_DEMONBANE = PlayerAttackProto.DARK_DEMONBANE,
  DARKLIGHT_AUTO = PlayerAttackProto.DARKLIGHT_AUTO,
  DARKLIGHT_SPEC = PlayerAttackProto.DARKLIGHT_SPEC,
  DAWN_AUTO = PlayerAttackProto.DAWN_AUTO,
  DAWN_SPEC = PlayerAttackProto.DAWN_SPEC,
  DART = PlayerAttackProto.DART,
  DDS_POKE = PlayerAttackProto.DDS_POKE,
  DDS_SPEC = PlayerAttackProto.DDS_SPEC,
  DHAROKS_GREATAXE = PlayerAttackProto.DHAROKS_GREATAXE,
  DINHS_SPEC = PlayerAttackProto.DINHS_SPEC,
  DRAGON_HUNTER_LANCE = PlayerAttackProto.DRAGON_HUNTER_LANCE,
  DRAGON_KNIFE_AUTO = PlayerAttackProto.DRAGON_KNIFE_AUTO,
  DRAGON_KNIFE_SPEC = PlayerAttackProto.DRAGON_KNIFE_SPEC,
  DRAGON_SCIMITAR = PlayerAttackProto.DRAGON_SCIMITAR,
  DUAL_MACUAHUITL = PlayerAttackProto.DUAL_MACUAHUITL,
  EARTHBOUND_TECPATL = PlayerAttackProto.EARTHBOUND_TECPATL,
  ELDER_MAUL = PlayerAttackProto.ELDER_MAUL,
  ELDER_MAUL_SPEC = PlayerAttackProto.ELDER_MAUL_SPEC,
  EMBERLIGHT_AUTO = PlayerAttackProto.EMBERLIGHT_AUTO,
  EMBERLIGHT_SPEC = PlayerAttackProto.EMBERLIGHT_SPEC,
  EYE_OF_AYAK_AUTO = PlayerAttackProto.EYE_OF_AYAK_AUTO,
  EYE_OF_AYAK_SPEC = PlayerAttackProto.EYE_OF_AYAK_SPEC,
  FANG_STAB = PlayerAttackProto.FANG_STAB,
  GLACIAL_TEMOTLI = PlayerAttackProto.GLACIAL_TEMOTLI,
  GOBLIN_PAINT_CANNON = PlayerAttackProto.GOBLIN_PAINT_CANNON,
  GODSWORD_SMACK = PlayerAttackProto.GODSWORD_SMACK,
  GUTHANS_WARSPEAR = PlayerAttackProto.GUTHANS_WARSPEAR,
  HAMMER_BOP = PlayerAttackProto.HAMMER_BOP,
  HAMMER_SPEC = PlayerAttackProto.HAMMER_SPEC,
  HAM_JOINT = PlayerAttackProto.HAM_JOINT,
  ICE_RUSH = PlayerAttackProto.ICE_RUSH,
  INQUISITORS_MACE = PlayerAttackProto.INQUISITORS_MACE,
  KARILS_CROSSBOW = PlayerAttackProto.KARILS_CROSSBOW,
  KICK = PlayerAttackProto.KICK,
  KODAI_BARRAGE = PlayerAttackProto.KODAI_BARRAGE,
  KODAI_BASH = PlayerAttackProto.KODAI_BASH,
  NM_STAFF_BARRAGE = PlayerAttackProto.NM_STAFF_BARRAGE,
  NM_STAFF_BASH = PlayerAttackProto.NM_STAFF_BASH,
  NOXIOUS_HALBERD = PlayerAttackProto.NOXIOUS_HALBERD,
  PUNCH = PlayerAttackProto.PUNCH,
  RAPIER = PlayerAttackProto.RAPIER,
  SAELDOR = PlayerAttackProto.SAELDOR,
  SANG = PlayerAttackProto.SANG,
  SANG_BARRAGE = PlayerAttackProto.SANG_BARRAGE,
  SCEPTRE_BARRAGE = PlayerAttackProto.SCEPTRE_BARRAGE,
  SCORCHING_BOW_AUTO = PlayerAttackProto.SCORCHING_BOW_AUTO,
  SCORCHING_BOW_SPEC = PlayerAttackProto.SCORCHING_BOW_SPEC,
  SCYTHE = PlayerAttackProto.SCYTHE,
  SCYTHE_UNCHARGED = PlayerAttackProto.SCYTHE_UNCHARGED,
  SGS_SPEC = PlayerAttackProto.SGS_SPEC,
  SHADOW = PlayerAttackProto.SHADOW,
  SHADOW_BARRAGE = PlayerAttackProto.SHADOW_BARRAGE,
  SOTD_BARRAGE = PlayerAttackProto.SOTD_BARRAGE,
  SOULREAPER_AXE = PlayerAttackProto.SOULREAPER_AXE,
  STAFF_OF_LIGHT_BARRAGE = PlayerAttackProto.STAFF_OF_LIGHT_BARRAGE,
  STAFF_OF_LIGHT_SWIPE = PlayerAttackProto.STAFF_OF_LIGHT_SWIPE,
  SULPHUR_BLADES = PlayerAttackProto.SULPHUR_BLADES,
  SWIFT_BLADE = PlayerAttackProto.SWIFT_BLADE,
  TENT_WHIP = PlayerAttackProto.TENT_WHIP,
  TONALZTICS_AUTO = PlayerAttackProto.TONALZTICS_AUTO,
  TONALZTICS_SPEC = PlayerAttackProto.TONALZTICS_SPEC,
  TONALZTICS_UNCHARGED = PlayerAttackProto.TONALZTICS_UNCHARGED,
  TORAGS_HAMMERS = PlayerAttackProto.TORAGS_HAMMERS,
  TOXIC_TRIDENT = PlayerAttackProto.TOXIC_TRIDENT,
  TOXIC_TRIDENT_BARRAGE = PlayerAttackProto.TOXIC_TRIDENT_BARRAGE,
  TOXIC_STAFF_BARRAGE = PlayerAttackProto.TOXIC_STAFF_BARRAGE,
  TOXIC_STAFF_SWIPE = PlayerAttackProto.TOXIC_STAFF_SWIPE,
  TRIDENT = PlayerAttackProto.TRIDENT,
  TRIDENT_BARRAGE = PlayerAttackProto.TRIDENT_BARRAGE,
  TWISTED_BOW = PlayerAttackProto.TWISTED_BOW,
  VENATOR_BOW = PlayerAttackProto.VENATOR_BOW,
  VERACS_FLAIL = PlayerAttackProto.VERACS_FLAIL,
  VOIDWAKER_AUTO = PlayerAttackProto.VOIDWAKER_AUTO,
  VOIDWAKER_SPEC = PlayerAttackProto.VOIDWAKER_SPEC,
  VOLATILE_NM_SPEC = PlayerAttackProto.VOLATILE_NM_SPEC,
  WEBWEAVER_AUTO = PlayerAttackProto.WEBWEAVER_AUTO,
  WEBWEAVER_SPEC = PlayerAttackProto.WEBWEAVER_SPEC,
  XGS_SPEC = PlayerAttackProto.XGS_SPEC,
  ZCB_AUTO = PlayerAttackProto.ZCB_AUTO,
  ZCB_SPEC = PlayerAttackProto.ZCB_SPEC,
  ZGS_SPEC = PlayerAttackProto.ZGS_SPEC,
  ZOMBIE_AXE = PlayerAttackProto.ZOMBIE_AXE,

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

  MOKHAIOTL_AUTO = NpcAttackProto.MOKHAIOTL_AUTO,
  MOKHAIOTL_RANGED_AUTO = NpcAttackProto.MOKHAIOTL_RANGED_AUTO,
  MOKHAIOTL_MAGE_AUTO = NpcAttackProto.MOKHAIOTL_MAGE_AUTO,
  MOKHAIOTL_MELEE_AUTO = NpcAttackProto.MOKHAIOTL_MELEE_AUTO,
  MOKHAIOTL_BALL = NpcAttackProto.MOKHAIOTL_BALL,
  MOKHAIOTL_MAGE_BALL = NpcAttackProto.MOKHAIOTL_MAGE_BALL,
  MOKHAIOTL_RANGED_BALL = NpcAttackProto.MOKHAIOTL_RANGED_BALL,
  MOKHAIOTL_CHARGE = NpcAttackProto.MOKHAIOTL_CHARGE,
  MOKHAIOTL_BLAST = NpcAttackProto.MOKHAIOTL_BLAST,
  MOKHAIOTL_RACECAR = NpcAttackProto.MOKHAIOTL_RACECAR,
  MOKHAIOTL_SLAM = NpcAttackProto.MOKHAIOTL_SLAM,
  MOKHAIOTL_SHOCKWAVE = NpcAttackProto.MOKHAIOTL_SHOCKWAVE,
  MOKHAIOTL_MELEE = NpcAttackProto.MOKHAIOTL_MELEE,

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

  INFERNO_BAT_AUTO = NpcAttackProto.INFERNO_BAT_AUTO,
  INFERNO_BLOB_RANGED = NpcAttackProto.INFERNO_BLOB_RANGED,
  INFERNO_BLOB_MAGE = NpcAttackProto.INFERNO_BLOB_MAGE,
  INFERNO_BLOB_MELEE = NpcAttackProto.INFERNO_BLOB_MELEE,
  INFERNO_BLOBLET_RANGED_AUTO = NpcAttackProto.INFERNO_BLOBLET_RANGED_AUTO,
  INFERNO_BLOBLET_MAGE_AUTO = NpcAttackProto.INFERNO_BLOBLET_MAGE_AUTO,
  INFERNO_BLOBLET_MELEE_AUTO = NpcAttackProto.INFERNO_BLOBLET_MELEE_AUTO,
  INFERNO_MELEER_AUTO = NpcAttackProto.INFERNO_MELEER_AUTO,
  INFERNO_MELEER_DIG = NpcAttackProto.INFERNO_MELEER_DIG,
  INFERNO_RANGER_AUTO = NpcAttackProto.INFERNO_RANGER_AUTO,
  INFERNO_RANGER_MELEE = NpcAttackProto.INFERNO_RANGER_MELEE,
  INFERNO_MAGER_AUTO = NpcAttackProto.INFERNO_MAGER_AUTO,
  INFERNO_MAGER_MELEE = NpcAttackProto.INFERNO_MAGER_MELEE,
  INFERNO_MAGER_RESURRECT = NpcAttackProto.INFERNO_MAGER_RESURRECT,
  INFERNO_JAD_RANGED = NpcAttackProto.INFERNO_JAD_RANGED,
  INFERNO_JAD_MAGE = NpcAttackProto.INFERNO_JAD_MAGE,
  INFERNO_JAD_MELEE = NpcAttackProto.INFERNO_JAD_MELEE,
  INFERNO_JAD_HEALER_AUTO = NpcAttackProto.INFERNO_JAD_HEALER_AUTO,
  INFERNO_ZUK_AUTO = NpcAttackProto.INFERNO_ZUK_AUTO,
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
  UNKNOWN = 0,
  ELITE_VOID = 1,
  BANDOS = 2,
  TORVA = 3,
  BLORVA = 4,
  OATHPLATE = 5,
  RADIANT_OATHPLATE = 6,
}

export type PlayerInfo = {
  currentUsername: string;
  gear: PrimaryMeleeGear;
};

/** Duration for which a session remains open after its last activity. */
export const SESSION_ACTIVITY_DURATION_MS = 30 * 60 * 1000;

export enum SessionStatus {
  ACTIVE = 0,
  COMPLETED = 1,
  HIDDEN = 2,
}

export type Session = {
  uuid: string;
  challengeType: ChallengeType;
  challengeMode: ChallengeMode;
  scale: number;
  partyHash: string;
  startTime: Date;
  endTime: Date | null;
  status: SessionStatus;
};

export function challengeName(type: ChallengeType): string {
  switch (type) {
    case ChallengeType.TOB:
      return 'Theatre of Blood';
    case ChallengeType.COX:
      return 'Chambers of Xeric';
    case ChallengeType.TOA:
      return 'Tombs of Amascut';
    case ChallengeType.COLOSSEUM:
      return 'Colosseum';
    case ChallengeType.INFERNO:
      return 'Inferno';
    case ChallengeType.MOKHAIOTL:
      return 'Doom of Mokhaiotl';
  }
}

export function stageName(stage: Stage, short: boolean = false): string {
  switch (stage) {
    case Stage.TOB_MAIDEN:
      return 'Maiden';
    case Stage.TOB_BLOAT:
      return 'Bloat';
    case Stage.TOB_NYLOCAS:
      return 'Nylocas';
    case Stage.TOB_SOTETSEG:
      return 'Sotetseg';
    case Stage.TOB_XARPUS:
      return 'Xarpus';
    case Stage.TOB_VERZIK:
      return 'Verzik';

    case Stage.COLOSSEUM_WAVE_12:
      return short ? 'Sol' : 'Sol Heredit';

    case Stage.INFERNO_WAVE_69:
      return short ? 'Zuk' : 'TzKal-Zuk';

    case Stage.TOA_APMEKEN:
      return 'Apmeken';
    case Stage.TOA_BABA:
      return 'Baba';
    case Stage.TOA_CRONDIS:
      return 'Crondis';
    case Stage.TOA_ZEBAK:
      return 'Zebak';
    case Stage.TOA_HET:
      return 'Het';
    case Stage.TOA_AKKHA:
      return 'Akkha';
    case Stage.TOA_SCABARAS:
      return 'Scabaras';
    case Stage.TOA_KEPHRI:
      return 'Kephri';
    case Stage.TOA_WARDENS:
      return 'Wardens';

    case Stage.COX_TEKTON:
      return 'Tekton';
    case Stage.COX_CRABS:
      return 'Crabs';
    case Stage.COX_ICE_DEMON:
      return 'Ice Demon';
    case Stage.COX_SHAMANS:
      return 'Shamans';
    case Stage.COX_VANGUARDS:
      return 'Vanguards';
    case Stage.COX_THIEVING:
      return 'Thieving';
    case Stage.COX_VESPULA:
      return 'Vespula';
    case Stage.COX_TIGHTROPE:
      return 'Tightrope';
    case Stage.COX_GUARDIANS:
      return 'Guardians';
    case Stage.COX_VASA:
      return 'Vasa';
    case Stage.COX_MYSTICS:
      return 'Mystics';
    case Stage.COX_MUTTADILE:
      return 'Muttadile';
    case Stage.COX_OLM:
      return 'Olm';

    case Stage.MOKHAIOTL_DELVE_8PLUS:
      return short ? 'D8+' : 'Delve 8+';
  }

  if (stage >= Stage.MOKHAIOTL_DELVE_1 && stage <= Stage.MOKHAIOTL_DELVE_8) {
    const prefix = short ? 'D' : 'Delve ';
    return `${prefix}${stage - Stage.MOKHAIOTL_DELVE_1 + 1}`;
  }

  if (stage >= Stage.COLOSSEUM_WAVE_1 && stage <= Stage.COLOSSEUM_WAVE_11) {
    const prefix = short ? 'W' : 'Wave ';
    return `${prefix}${stage - Stage.COLOSSEUM_WAVE_1 + 1}`;
  }

  if (stage >= Stage.INFERNO_WAVE_1 && stage <= Stage.INFERNO_WAVE_68) {
    const prefix = short ? 'W' : 'Wave ';
    return `${prefix}${stage - Stage.INFERNO_WAVE_1 + 1}`;
  }

  return 'Unknown';
}

const STAGES_BY_CHALLENGE = {
  [ChallengeType.TOB]: [
    Stage.TOB_MAIDEN,
    Stage.TOB_BLOAT,
    Stage.TOB_NYLOCAS,
    Stage.TOB_SOTETSEG,
    Stage.TOB_XARPUS,
    Stage.TOB_VERZIK,
  ],
  [ChallengeType.COLOSSEUM]: [
    Stage.COLOSSEUM_WAVE_1,
    Stage.COLOSSEUM_WAVE_2,
    Stage.COLOSSEUM_WAVE_3,
    Stage.COLOSSEUM_WAVE_4,
    Stage.COLOSSEUM_WAVE_5,
    Stage.COLOSSEUM_WAVE_6,
    Stage.COLOSSEUM_WAVE_7,
    Stage.COLOSSEUM_WAVE_8,
    Stage.COLOSSEUM_WAVE_9,
    Stage.COLOSSEUM_WAVE_10,
    Stage.COLOSSEUM_WAVE_11,
    Stage.COLOSSEUM_WAVE_12,
  ],
  [ChallengeType.TOA]: [
    Stage.TOA_APMEKEN,
    Stage.TOA_BABA,
    Stage.TOA_CRONDIS,
    Stage.TOA_ZEBAK,
    Stage.TOA_HET,
    Stage.TOA_AKKHA,
    Stage.TOA_SCABARAS,
    Stage.TOA_KEPHRI,
    Stage.TOA_WARDENS,
  ],
  [ChallengeType.COX]: [
    Stage.COX_TEKTON,
    Stage.COX_CRABS,
    Stage.COX_ICE_DEMON,
    Stage.COX_SHAMANS,
    Stage.COX_VANGUARDS,
    Stage.COX_THIEVING,
    Stage.COX_VESPULA,
    Stage.COX_TIGHTROPE,
    Stage.COX_GUARDIANS,
    Stage.COX_VASA,
    Stage.COX_MYSTICS,
    Stage.COX_MUTTADILE,
    Stage.COX_OLM,
  ],
  [ChallengeType.MOKHAIOTL]: [
    Stage.MOKHAIOTL_DELVE_1,
    Stage.MOKHAIOTL_DELVE_2,
    Stage.MOKHAIOTL_DELVE_3,
    Stage.MOKHAIOTL_DELVE_4,
    Stage.MOKHAIOTL_DELVE_5,
    Stage.MOKHAIOTL_DELVE_6,
    Stage.MOKHAIOTL_DELVE_7,
    Stage.MOKHAIOTL_DELVE_8,
    Stage.MOKHAIOTL_DELVE_8PLUS,
  ],
  [ChallengeType.INFERNO]: [
    Stage.INFERNO_WAVE_1,
    Stage.INFERNO_WAVE_2,
    Stage.INFERNO_WAVE_3,
    Stage.INFERNO_WAVE_4,
    Stage.INFERNO_WAVE_5,
    Stage.INFERNO_WAVE_6,
    Stage.INFERNO_WAVE_7,
    Stage.INFERNO_WAVE_8,
    Stage.INFERNO_WAVE_9,
    Stage.INFERNO_WAVE_10,
    Stage.INFERNO_WAVE_11,
    Stage.INFERNO_WAVE_12,
    Stage.INFERNO_WAVE_13,
    Stage.INFERNO_WAVE_14,
    Stage.INFERNO_WAVE_15,
    Stage.INFERNO_WAVE_16,
    Stage.INFERNO_WAVE_17,
    Stage.INFERNO_WAVE_18,
    Stage.INFERNO_WAVE_19,
    Stage.INFERNO_WAVE_20,
    Stage.INFERNO_WAVE_21,
    Stage.INFERNO_WAVE_22,
    Stage.INFERNO_WAVE_23,
    Stage.INFERNO_WAVE_24,
    Stage.INFERNO_WAVE_25,
    Stage.INFERNO_WAVE_26,
    Stage.INFERNO_WAVE_27,
    Stage.INFERNO_WAVE_28,
    Stage.INFERNO_WAVE_29,
    Stage.INFERNO_WAVE_30,
    Stage.INFERNO_WAVE_31,
    Stage.INFERNO_WAVE_32,
    Stage.INFERNO_WAVE_33,
    Stage.INFERNO_WAVE_34,
    Stage.INFERNO_WAVE_35,
    Stage.INFERNO_WAVE_36,
    Stage.INFERNO_WAVE_37,
    Stage.INFERNO_WAVE_38,
    Stage.INFERNO_WAVE_39,
    Stage.INFERNO_WAVE_40,
    Stage.INFERNO_WAVE_41,
    Stage.INFERNO_WAVE_42,
    Stage.INFERNO_WAVE_43,
    Stage.INFERNO_WAVE_44,
    Stage.INFERNO_WAVE_45,
    Stage.INFERNO_WAVE_46,
    Stage.INFERNO_WAVE_47,
    Stage.INFERNO_WAVE_48,
    Stage.INFERNO_WAVE_49,
    Stage.INFERNO_WAVE_50,
    Stage.INFERNO_WAVE_51,
    Stage.INFERNO_WAVE_52,
    Stage.INFERNO_WAVE_53,
    Stage.INFERNO_WAVE_54,
    Stage.INFERNO_WAVE_55,
    Stage.INFERNO_WAVE_56,
    Stage.INFERNO_WAVE_57,
    Stage.INFERNO_WAVE_58,
    Stage.INFERNO_WAVE_59,
    Stage.INFERNO_WAVE_60,
    Stage.INFERNO_WAVE_61,
    Stage.INFERNO_WAVE_62,
    Stage.INFERNO_WAVE_63,
    Stage.INFERNO_WAVE_64,
    Stage.INFERNO_WAVE_65,
    Stage.INFERNO_WAVE_66,
    Stage.INFERNO_WAVE_67,
    Stage.INFERNO_WAVE_68,
    Stage.INFERNO_WAVE_69,
  ],
};

/**
 * Returns all stages of a given challenge.
 * @param challenge The challenge type.
 * @returns List of stages within the challenge.
 */
export function stagesForChallenge(challenge: ChallengeType): Stage[] {
  return STAGES_BY_CHALLENGE[challenge];
}
