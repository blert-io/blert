import { ChallengeMode } from './challenge';

export enum SplitType {
  // Theatre of Blood splits.
  // All distinct ToB splits must have consecutive integer values, in the order
  // [entry mode, regular, hard mode] to allow for easy indexing on mode.
  TOB_ENTRY_CHALLENGE = 0,
  TOB_REG_CHALLENGE = 1,
  TOB_HM_CHALLENGE = 2,
  TOB_CHALLENGE = TOB_ENTRY_CHALLENGE,

  TOB_ENTRY_OVERALL = 3,
  TOB_REG_OVERALL = 4,
  TOB_HM_OVERALL = 5,
  TOB_OVERALL = TOB_ENTRY_OVERALL,

  TOB_ENTRY_MAIDEN = 6,
  TOB_REG_MAIDEN = 7,
  TOB_HM_MAIDEN = 8,
  TOB_MAIDEN = TOB_ENTRY_MAIDEN,

  TOB_ENTRY_MAIDEN_70S = 9,
  TOB_REG_MAIDEN_70S = 10,
  TOB_HM_MAIDEN_70S = 11,
  TOB_MAIDEN_70S = TOB_ENTRY_MAIDEN_70S,

  TOB_ENTRY_MAIDEN_50S = 12,
  TOB_REG_MAIDEN_50S = 13,
  TOB_HM_MAIDEN_50S = 14,
  TOB_MAIDEN_50S = TOB_ENTRY_MAIDEN_50S,

  TOB_ENTRY_MAIDEN_30S = 15,
  TOB_REG_MAIDEN_30S = 16,
  TOB_HM_MAIDEN_30S = 17,
  TOB_MAIDEN_30S = TOB_ENTRY_MAIDEN_30S,

  TOB_ENTRY_MAIDEN_70S_50S = 18,
  TOB_REG_MAIDEN_70S_50S = 19,
  TOB_HM_MAIDEN_70S_50S = 20,
  TOB_MAIDEN_70S_50S = TOB_ENTRY_MAIDEN_70S_50S,

  TOB_ENTRY_MAIDEN_50S_30S = 21,
  TOB_REG_MAIDEN_50S_30S = 22,
  TOB_HM_MAIDEN_50S_30S = 23,
  TOB_MAIDEN_50S_30S = TOB_ENTRY_MAIDEN_50S_30S,

  TOB_ENTRY_MAIDEN_30S_END = 24,
  TOB_REG_MAIDEN_30S_END = 25,
  TOB_HM_MAIDEN_30S_END = 26,
  TOB_MAIDEN_30S_END = TOB_ENTRY_MAIDEN_30S_END,

  TOB_ENTRY_BLOAT = 27,
  TOB_REG_BLOAT = 28,
  TOB_HM_BLOAT = 29,
  TOB_BLOAT = TOB_ENTRY_BLOAT,

  TOB_ENTRY_NYLO_ROOM = 30,
  TOB_REG_NYLO_ROOM = 31,
  TOB_HM_NYLO_ROOM = 32,
  TOB_NYLO_ROOM = TOB_ENTRY_NYLO_ROOM,

  TOB_ENTRY_NYLO_CAP = 33,
  TOB_REG_NYLO_CAP = 34,
  TOB_HM_NYLO_CAP = 35,
  TOB_NYLO_CAP = TOB_ENTRY_NYLO_CAP,

  TOB_ENTRY_NYLO_WAVES = 36,
  TOB_REG_NYLO_WAVES = 37,
  TOB_HM_NYLO_WAVES = 38,
  TOB_NYLO_WAVES = TOB_ENTRY_NYLO_WAVES,

  TOB_ENTRY_NYLO_CLEANUP = 39,
  TOB_REG_NYLO_CLEANUP = 40,
  TOB_HM_NYLO_CLEANUP = 41,
  TOB_NYLO_CLEANUP = TOB_ENTRY_NYLO_CLEANUP,

  TOB_ENTRY_NYLO_BOSS_SPAWN = 42,
  TOB_REG_NYLO_BOSS_SPAWN = 43,
  TOB_HM_NYLO_BOSS_SPAWN = 44,
  TOB_NYLO_BOSS_SPAWN = TOB_ENTRY_NYLO_BOSS_SPAWN,

  TOB_ENTRY_NYLO_BOSS = 45,
  TOB_REG_NYLO_BOSS = 46,
  TOB_HM_NYLO_BOSS = 47,
  TOB_NYLO_BOSS = TOB_ENTRY_NYLO_BOSS,

  TOB_ENTRY_SOTETSEG = 48,
  TOB_REG_SOTETSEG = 49,
  TOB_HM_SOTETSEG = 50,
  TOB_SOTETSEG = TOB_ENTRY_SOTETSEG,

  TOB_ENTRY_SOTETSEG_66 = 51,
  TOB_REG_SOTETSEG_66 = 52,
  TOB_HM_SOTETSEG_66 = 53,
  TOB_SOTETSEG_66 = TOB_ENTRY_SOTETSEG_66,

  TOB_ENTRY_SOTETSEG_33 = 54,
  TOB_REG_SOTETSEG_33 = 55,
  TOB_HM_SOTETSEG_33 = 56,
  TOB_SOTETSEG_33 = TOB_ENTRY_SOTETSEG_33,

  TOB_ENTRY_SOTETSEG_MAZE_1 = 57,
  TOB_REG_SOTETSEG_MAZE_1 = 58,
  TOB_HM_SOTETSEG_MAZE_1 = 59,
  TOB_SOTETSEG_MAZE_1 = TOB_ENTRY_SOTETSEG_MAZE_1,

  TOB_ENTRY_SOTETSEG_MAZE_2 = 60,
  TOB_REG_SOTETSEG_MAZE_2 = 61,
  TOB_HM_SOTETSEG_MAZE_2 = 62,
  TOB_SOTETSEG_MAZE_2 = TOB_ENTRY_SOTETSEG_MAZE_2,

  TOB_ENTRY_SOTETSEG_P1 = TOB_ENTRY_SOTETSEG_66,
  TOB_REG_SOTETSEG_P1 = TOB_REG_SOTETSEG_66,
  TOB_HM_SOTETSEG_P1 = TOB_HM_SOTETSEG_66,
  TOB_SOTETSEG_P1 = TOB_SOTETSEG_66,

  TOB_ENTRY_SOTETSEG_P2 = 63,
  TOB_REG_SOTETSEG_P2 = 64,
  TOB_HM_SOTETSEG_P2 = 65,
  TOB_SOTETSEG_P2 = TOB_ENTRY_SOTETSEG_P2,

  TOB_ENTRY_SOTETSEG_P3 = 66,
  TOB_REG_SOTETSEG_P3 = 67,
  TOB_HM_SOTETSEG_P3 = 68,
  TOB_SOTETSEG_P3 = TOB_ENTRY_SOTETSEG_P3,

  TOB_ENTRY_XARPUS = 69,
  TOB_REG_XARPUS = 70,
  TOB_HM_XARPUS = 71,
  TOB_XARPUS = TOB_ENTRY_XARPUS,

  TOB_ENTRY_XARPUS_EXHUMES = 72,
  TOB_REG_XARPUS_EXHUMES = 73,
  TOB_HM_XARPUS_EXHUMES = 74,
  TOB_XARPUS_EXHUMES = TOB_ENTRY_XARPUS_EXHUMES,

  TOB_ENTRY_XARPUS_SCREECH = 75,
  TOB_REG_XARPUS_SCREECH = 76,
  TOB_HM_XARPUS_SCREECH = 77,
  TOB_XARPUS_SCREECH = TOB_ENTRY_XARPUS_SCREECH,

  TOB_ENTRY_XARPUS_P1 = TOB_ENTRY_XARPUS_EXHUMES,
  TOB_REG_XARPUS_P1 = TOB_REG_XARPUS_EXHUMES,
  TOB_HM_XARPUS_P1 = TOB_HM_XARPUS_EXHUMES,
  TOB_XARPUS_P1 = TOB_XARPUS_EXHUMES,

  TOB_ENTRY_XARPUS_P2 = 78,
  TOB_REG_XARPUS_P2 = 79,
  TOB_HM_XARPUS_P2 = 80,
  TOB_XARPUS_P2 = TOB_ENTRY_XARPUS_P2,

  TOB_ENTRY_XARPUS_P3 = 81,
  TOB_REG_XARPUS_P3 = 82,
  TOB_HM_XARPUS_P3 = 83,
  TOB_XARPUS_P3 = TOB_ENTRY_XARPUS_P3,

  TOB_ENTRY_VERZIK_ROOM = 84,
  TOB_REG_VERZIK_ROOM = 85,
  TOB_HM_VERZIK_ROOM = 86,
  TOB_VERZIK_ROOM = TOB_ENTRY_VERZIK_ROOM,

  TOB_ENTRY_VERZIK_P1_END = 87,
  TOB_REG_VERZIK_P1_END = 88,
  TOB_HM_VERZIK_P1_END = 89,
  TOB_VERZIK_P1_END = TOB_ENTRY_VERZIK_P1_END,

  TOB_ENTRY_VERZIK_REDS = 90,
  TOB_REG_VERZIK_REDS = 91,
  TOB_HM_VERZIK_REDS = 92,
  TOB_VERZIK_REDS = TOB_ENTRY_VERZIK_REDS,

  TOB_ENTRY_VERZIK_P2_END = 93,
  TOB_REG_VERZIK_P2_END = 94,
  TOB_HM_VERZIK_P2_END = 95,
  TOB_VERZIK_P2_END = TOB_ENTRY_VERZIK_P2_END,

  TOB_ENTRY_VERZIK_P1 = TOB_ENTRY_VERZIK_P1_END,
  TOB_REG_VERZIK_P1 = TOB_REG_VERZIK_P1_END,
  TOB_HM_VERZIK_P1 = TOB_HM_VERZIK_P1_END,
  TOB_VERZIK_P1 = TOB_ENTRY_VERZIK_P1,

  TOB_ENTRY_VERZIK_P2 = 96,
  TOB_REG_VERZIK_P2 = 97,
  TOB_HM_VERZIK_P2 = 98,
  TOB_VERZIK_P2 = TOB_ENTRY_VERZIK_P2,

  TOB_ENTRY_VERZIK_P3 = 99,
  TOB_REG_VERZIK_P3 = 100,
  TOB_HM_VERZIK_P3 = 101,
  TOB_VERZIK_P3 = TOB_ENTRY_VERZIK_P3,

  // Colosseum wave times.
  COLOSSEUM_CHALLENGE = 150,
  COLOSSEUM_OVERALL = 151,
  COLOSSEUM_WAVE_1 = 152,
  COLOSSEUM_WAVE_2 = 153,
  COLOSSEUM_WAVE_3 = 154,
  COLOSSEUM_WAVE_4 = 155,
  COLOSSEUM_WAVE_5 = 156,
  COLOSSEUM_WAVE_6 = 157,
  COLOSSEUM_WAVE_7 = 158,
  COLOSSEUM_WAVE_8 = 159,
  COLOSSEUM_WAVE_9 = 160,
  COLOSSEUM_WAVE_10 = 161,
  COLOSSEUM_WAVE_11 = 162,
  COLOSSEUM_WAVE_12 = 163,
}

const genericTobSplits = [
  SplitType.TOB_CHALLENGE,
  SplitType.TOB_OVERALL,
  SplitType.TOB_MAIDEN,
  SplitType.TOB_MAIDEN_70S,
  SplitType.TOB_MAIDEN_50S,
  SplitType.TOB_MAIDEN_30S,
  SplitType.TOB_MAIDEN_70S_50S,
  SplitType.TOB_MAIDEN_50S_30S,
  SplitType.TOB_MAIDEN_30S_END,
  SplitType.TOB_BLOAT,
  SplitType.TOB_NYLO_ROOM,
  SplitType.TOB_NYLO_CAP,
  SplitType.TOB_NYLO_WAVES,
  SplitType.TOB_NYLO_CLEANUP,
  SplitType.TOB_NYLO_BOSS_SPAWN,
  SplitType.TOB_NYLO_BOSS,
  SplitType.TOB_SOTETSEG,
  SplitType.TOB_SOTETSEG_66,
  SplitType.TOB_SOTETSEG_33,
  SplitType.TOB_SOTETSEG_MAZE_1,
  SplitType.TOB_SOTETSEG_MAZE_2,
  SplitType.TOB_SOTETSEG_P1,
  SplitType.TOB_SOTETSEG_P2,
  SplitType.TOB_SOTETSEG_P3,
  SplitType.TOB_XARPUS,
  SplitType.TOB_XARPUS_EXHUMES,
  SplitType.TOB_XARPUS_SCREECH,
  SplitType.TOB_XARPUS_P1,
  SplitType.TOB_XARPUS_P2,
  SplitType.TOB_XARPUS_P3,
  SplitType.TOB_VERZIK_ROOM,
  SplitType.TOB_VERZIK_P1_END,
  SplitType.TOB_VERZIK_REDS,
  SplitType.TOB_VERZIK_P2_END,
  SplitType.TOB_VERZIK_P1,
  SplitType.TOB_VERZIK_P2,
  SplitType.TOB_VERZIK_P3,
];

/**
 * Return the mode-specific version of a generic split type.
 *
 * This must **only** be called with a generic split type, e.g.
 * `TOB_NYLO_BOSS_SPAWN`, and not with a mode-specific type like e.g.
 * `TOB_REG_NYLO_BOSS_SPAWN`.
 *
 * @param split The generic split type.
 * @param mode Raid mode.
 * @returns Split type for the raid mode.
 */
export function adjustSplitForMode(
  split: SplitType,
  mode: ChallengeMode,
): SplitType {
  if (genericTobSplits.includes(split)) {
    const offset =
      mode === ChallengeMode.TOB_ENTRY
        ? 0
        : mode === ChallengeMode.TOB_REGULAR
          ? 1
          : 2;
    return split + offset;
  }

  return split;
}

/**
 * Returns the generic version of a mode-specific split type.
 * @param split The mode-specific split type.
 * @returns The generic split type.
 */
export function generalizeSplit(split: SplitType): SplitType {
  if (split >= SplitType.TOB_CHALLENGE && split <= SplitType.TOB_HM_VERZIK_P3) {
    return split - (split % 3);
  }

  return split;
}
