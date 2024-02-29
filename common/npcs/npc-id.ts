export enum NpcId {
  MAIDEN_ENTRY = 10814,
  MAIDEN_ENTRY_10815 = 10815,
  MAIDEN_ENTRY_10816 = 10816,
  MAIDEN_ENTRY_10817 = 10817,
  MAIDEN_ENTRY_10818 = 10818,
  MAIDEN_ENTRY_10819 = 10819,

  MAIDEN_REGULAR = 8360,
  MAIDEN_REGULAR_8361 = 8361,
  MAIDEN_REGULAR_8362 = 8362,
  MAIDEN_REGULAR_8363 = 8363,
  MAIDEN_REGULAR_8364 = 8364,
  MAIDEN_REGULAR_8365 = 8365,

  MAIDEN_HARD = 10822,
  MAIDEN_HARD_10823 = 10823,
  MAIDEN_HARD_10824 = 10824,
  MAIDEN_HARD_10825 = 10825,
  MAIDEN_HARD_10826 = 10826,
  MAIDEN_HARD_10827 = 10827,

  MAIDEN_MATOMENOS_ENTRY = 10820,
  MAIDEN_MATOMENOS_REGULAR = 8366,
  MAIDEN_MATOMENOS_HARD = 10828,

  MAIDEN_BLOOD_SPAWN_ENTRY = 10821,
  MAIDEN_BLOOD_SPAWN_REGULAR = 8367,
  MAIDEN_BLOOD_SPAWN_HARD = 10829,

  BLOAT_ENTRY = 10812,
  BLOAT_REGULAR = 8359,
  BLOAT_HARD = 10813,
}

const MAIDEN_ENTRY_IDS = [
  NpcId.MAIDEN_ENTRY,
  NpcId.MAIDEN_ENTRY_10815,
  NpcId.MAIDEN_ENTRY_10816,
  NpcId.MAIDEN_ENTRY_10817,
  NpcId.MAIDEN_ENTRY_10818,
  NpcId.MAIDEN_ENTRY_10819,
];

const MAIDEN_REGULAR_IDS = [
  NpcId.MAIDEN_REGULAR,
  NpcId.MAIDEN_REGULAR_8361,
  NpcId.MAIDEN_REGULAR_8362,
  NpcId.MAIDEN_REGULAR_8363,
  NpcId.MAIDEN_REGULAR_8364,
  NpcId.MAIDEN_REGULAR_8365,
];

const MAIDEN_HARD_IDS = [
  NpcId.MAIDEN_HARD,
  NpcId.MAIDEN_HARD_10823,
  NpcId.MAIDEN_HARD_10824,
  NpcId.MAIDEN_HARD_10825,
  NpcId.MAIDEN_HARD_10826,
  NpcId.MAIDEN_HARD_10827,
];

export class Npc {
  static isMaidenEntry(npcId: number): boolean {
    return MAIDEN_ENTRY_IDS.includes(npcId);
  }

  static isMaidenRegular(npcId: number): boolean {
    return MAIDEN_REGULAR_IDS.includes(npcId);
  }

  static isMaidenHard(npcId: number): boolean {
    return MAIDEN_HARD_IDS.includes(npcId);
  }

  static isMaiden(npcId: number): boolean {
    return (
      Npc.isMaidenEntry(npcId) ||
      Npc.isMaidenRegular(npcId) ||
      Npc.isMaidenHard(npcId)
    );
  }

  static isMaidenMatomenos(npcId: number): boolean {
    return (
      npcId === NpcId.MAIDEN_MATOMENOS_ENTRY ||
      npcId === NpcId.MAIDEN_MATOMENOS_REGULAR ||
      npcId === NpcId.MAIDEN_MATOMENOS_HARD
    );
  }

  static isMaidenBloodSpawn(npcId: number): boolean {
    return (
      npcId === NpcId.MAIDEN_BLOOD_SPAWN_ENTRY ||
      npcId === NpcId.MAIDEN_BLOOD_SPAWN_REGULAR ||
      npcId === NpcId.MAIDEN_BLOOD_SPAWN_HARD
    );
  }

  static isBloat(npcId: number): boolean {
    return (
      npcId === NpcId.BLOAT_ENTRY ||
      npcId === NpcId.BLOAT_REGULAR ||
      npcId === NpcId.BLOAT_HARD
    );
  }
}
