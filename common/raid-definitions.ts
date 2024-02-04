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