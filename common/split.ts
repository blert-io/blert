import { ChallengeMode, Stage } from './challenge';

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

  // Mokhaiotl splits.
  MOKHAIOTL_CHALLENGE = 200,
  MOKHAIOTL_OVERALL = 201,
  MOKHAIOTL_DELVE_1 = 202,
  MOKHAIOTL_DELVE_2 = 203,
  MOKHAIOTL_DELVE_3 = 204,
  MOKHAIOTL_DELVE_4 = 205,
  MOKHAIOTL_DELVE_5 = 206,
  MOKHAIOTL_DELVE_6 = 207,
  MOKHAIOTL_DELVE_7 = 208,
  MOKHAIOTL_DELVE_8 = 209,
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
      mode === ChallengeMode.TOB_REGULAR
        ? 1
        : mode === ChallengeMode.TOB_HARD
          ? 2
          : 0;
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

/**
 * Given a split, returns every mode of the split.
 *
 * For example, if the split is `TOB_CHALLENGE`, this will return
 * `[TOB_ENTRY_CHALLENGE, TOB_REG_CHALLENGE, TOB_HM_CHALLENGE]`.
 * May be called with either a generic or mode-specific split.
 *
 * @param split The split.
 * @returns Array containing each mode of the split.
 */
export function allSplitModes(split: SplitType): SplitType[] {
  split = generalizeSplit(split);
  if (genericTobSplits.includes(split)) {
    return [split, split + 1, split + 2];
  }

  return [split];
}

/**
 * Returns the name of a split.
 *
 * @param split The split.
 * @param full Whether to include the full name of the split.
 * @param excludeStage Whether to exclude the stage name from the split name.
 *   Overrides `full` if set.
 * @returns The name of the split.
 */
export function splitName(
  split: SplitType,
  full: boolean = false,
  excludeStage: boolean = false,
): string {
  switch (generalizeSplit(split)) {
    case SplitType.TOB_CHALLENGE:
      return full ? 'ToB challenge time' : 'Challenge time';
    case SplitType.TOB_OVERALL:
      return full ? 'ToB overall time' : 'Overall time';
    case SplitType.TOB_MAIDEN:
      return full ? 'Maiden room time' : 'Maiden';
    case SplitType.TOB_MAIDEN_70S:
      return excludeStage ? '70s' : 'Maiden 70s';
    case SplitType.TOB_MAIDEN_50S:
      return excludeStage ? '50s' : 'Maiden 50s';
    case SplitType.TOB_MAIDEN_30S:
      return excludeStage ? '30s' : 'Maiden 30s';
    case SplitType.TOB_MAIDEN_70S_50S:
      return excludeStage ? '70s-50s' : 'Maiden 70s-50s';
    case SplitType.TOB_MAIDEN_50S_30S:
      return excludeStage ? '50s-30s' : 'Maiden 50s-30s';
    case SplitType.TOB_MAIDEN_30S_END:
      return excludeStage ? '30s-end' : 'Maiden 30s-end';
    case SplitType.TOB_BLOAT:
      return full ? 'Bloat room time' : 'Bloat';
    case SplitType.TOB_NYLO_ROOM:
      return full ? 'Nylocas room time' : 'Nylocas';
    case SplitType.TOB_NYLO_CAP:
      return excludeStage ? 'Cap' : 'Nylocas cap';
    case SplitType.TOB_NYLO_WAVES:
      return excludeStage ? 'Waves' : 'Nylocas waves';
    case SplitType.TOB_NYLO_CLEANUP:
      return excludeStage ? 'Cleanup' : 'Nylocas cleanup';
    case SplitType.TOB_NYLO_BOSS_SPAWN:
      return excludeStage ? 'Boss spawn' : 'Nylocas boss spawn';
    case SplitType.TOB_NYLO_BOSS:
      if (excludeStage) {
        return 'Boss';
      }
      return full ? 'Nylocas boss time' : 'Nylocas boss';
    case SplitType.TOB_SOTETSEG:
      return full ? 'Sotetseg room time' : 'Sotetseg';
    case SplitType.TOB_SOTETSEG_66:
      return excludeStage ? '66%' : 'Sotetseg 66%';
    case SplitType.TOB_SOTETSEG_33:
      return excludeStage ? '33%' : 'Sotetseg 33%';
    case SplitType.TOB_SOTETSEG_MAZE_1:
      return excludeStage ? 'Maze 1' : 'Sotetseg maze 1';
    case SplitType.TOB_SOTETSEG_MAZE_2:
      return excludeStage ? 'Maze 2' : 'Sotetseg maze 2';
    case SplitType.TOB_SOTETSEG_P1:
      return excludeStage ? 'P1' : 'Sotetseg P1';
    case SplitType.TOB_SOTETSEG_P2:
      return excludeStage ? 'P2' : 'Sotetseg P2';
    case SplitType.TOB_SOTETSEG_P3:
      return excludeStage ? 'P3' : 'Sotetseg P3';
    case SplitType.TOB_XARPUS:
      return full ? 'Xarpus room time' : 'Xarpus';
    case SplitType.TOB_XARPUS_EXHUMES:
      return excludeStage ? 'Exhumes' : 'Xarpus exhumes';
    case SplitType.TOB_XARPUS_SCREECH:
      return excludeStage ? 'Screech' : 'Xarpus screech';
    case SplitType.TOB_XARPUS_P1:
      return excludeStage ? 'P1' : 'Xarpus P1';
    case SplitType.TOB_XARPUS_P2:
      return excludeStage ? 'P2' : 'Xarpus P2';
    case SplitType.TOB_XARPUS_P3:
      return excludeStage ? 'P3' : 'Xarpus P3';
    case SplitType.TOB_VERZIK_ROOM:
      return full ? 'Verzik room time' : 'Verzik';
    case SplitType.TOB_VERZIK_P1_END:
      return excludeStage ? 'P1' : 'Verzik P1';
    case SplitType.TOB_VERZIK_REDS:
      return excludeStage ? 'Reds' : 'Verzik reds';
    case SplitType.TOB_VERZIK_P2_END:
      return excludeStage ? 'P2' : 'Verzik P2 end';
    case SplitType.TOB_VERZIK_P1:
      return excludeStage ? 'P1' : 'Verzik P1';
    case SplitType.TOB_VERZIK_P2:
      return excludeStage ? 'P2' : 'Verzik P2';
    case SplitType.TOB_VERZIK_P3:
      return excludeStage ? 'P3' : 'Verzik P3';
    case SplitType.COLOSSEUM_CHALLENGE:
      return full ? 'Colosseum challenge time' : 'Challenge time';
    case SplitType.COLOSSEUM_OVERALL:
      return full ? 'Colosseum overall time' : 'Overall time';
    case SplitType.COLOSSEUM_WAVE_1:
      return full ? 'Colosseum Wave 1' : 'Wave 1';
    case SplitType.COLOSSEUM_WAVE_2:
      return full ? 'Colosseum Wave 2' : 'Wave 2';
    case SplitType.COLOSSEUM_WAVE_3:
      return full ? 'Colosseum Wave 3' : 'Wave 3';
    case SplitType.COLOSSEUM_WAVE_4:
      return full ? 'Colosseum Wave 4' : 'Wave 4';
    case SplitType.COLOSSEUM_WAVE_5:
      return full ? 'Colosseum Wave 5' : 'Wave 5';
    case SplitType.COLOSSEUM_WAVE_6:
      return full ? 'Colosseum Wave 6' : 'Wave 6';
    case SplitType.COLOSSEUM_WAVE_7:
      return full ? 'Colosseum Wave 7' : 'Wave 7';
    case SplitType.COLOSSEUM_WAVE_8:
      return full ? 'Colosseum Wave 8' : 'Wave 8';
    case SplitType.COLOSSEUM_WAVE_9:
      return full ? 'Colosseum Wave 9' : 'Wave 9';
    case SplitType.COLOSSEUM_WAVE_10:
      return full ? 'Colosseum Wave 10' : 'Wave 10';
    case SplitType.COLOSSEUM_WAVE_11:
      return full ? 'Colosseum Wave 11' : 'Wave 11';
    case SplitType.COLOSSEUM_WAVE_12:
      return full ? 'Sol Heredit time' : 'Sol Heredit';
    case SplitType.MOKHAIOTL_CHALLENGE:
      return full
        ? 'Mokhaiotl Delve 1-8 challenge time'
        : 'Delve 1-8 challenge time';
    case SplitType.MOKHAIOTL_OVERALL:
      return full
        ? 'Mokhaiotl Delve 1-8 overall time'
        : 'Delve 1-8 overall time';
    case SplitType.MOKHAIOTL_DELVE_1:
      return full ? 'Mokhaiotl Delve 1' : 'Delve 1';
    case SplitType.MOKHAIOTL_DELVE_2:
      return full ? 'Mokhaiotl Delve 2' : 'Delve 2';
    case SplitType.MOKHAIOTL_DELVE_3:
      return full ? 'Mokhaiotl Delve 3' : 'Delve 3';
    case SplitType.MOKHAIOTL_DELVE_4:
      return full ? 'Mokhaiotl Delve 4' : 'Delve 4';
    case SplitType.MOKHAIOTL_DELVE_5:
      return full ? 'Mokhaiotl Delve 5' : 'Delve 5';
    case SplitType.MOKHAIOTL_DELVE_6:
      return full ? 'Mokhaiotl Delve 6' : 'Delve 6';
    case SplitType.MOKHAIOTL_DELVE_7:
      return full ? 'Mokhaiotl Delve 7' : 'Delve 7';
    case SplitType.MOKHAIOTL_DELVE_8:
      return full ? 'Mokhaiotl Delve 8' : 'Delve 8';
    default:
      return 'Unknown split';
  }
}

/**
 * Given a split, returns the stage to which it belongs.
 * If the split does not belong to a stage (e.g. an overall raid split),
 * returns `Stage.UNKNOWN`.
 *
 * @param split The split.
 * @returns The stage to which the split belongs.
 */
export function splitToStage(split: SplitType): Stage {
  if (
    split >= SplitType.TOB_ENTRY_MAIDEN &&
    split <= SplitType.TOB_HM_MAIDEN_30S_END
  ) {
    return Stage.TOB_MAIDEN;
  }

  if (split >= SplitType.TOB_ENTRY_BLOAT && split <= SplitType.TOB_HM_BLOAT) {
    return Stage.TOB_BLOAT;
  }

  if (
    split >= SplitType.TOB_ENTRY_NYLO_ROOM &&
    split <= SplitType.TOB_HM_NYLO_BOSS
  ) {
    return Stage.TOB_NYLOCAS;
  }

  if (
    split >= SplitType.TOB_ENTRY_SOTETSEG &&
    split <= SplitType.TOB_HM_SOTETSEG_P3
  ) {
    return Stage.TOB_SOTETSEG;
  }

  if (
    split >= SplitType.TOB_ENTRY_XARPUS &&
    split <= SplitType.TOB_HM_XARPUS_P3
  ) {
    return Stage.TOB_XARPUS;
  }

  if (
    split >= SplitType.TOB_ENTRY_VERZIK_ROOM &&
    split <= SplitType.TOB_HM_VERZIK_P3
  ) {
    return Stage.TOB_VERZIK;
  }

  if (
    split >= SplitType.COLOSSEUM_WAVE_1 &&
    split <= SplitType.COLOSSEUM_WAVE_12
  ) {
    const wave = split - SplitType.COLOSSEUM_WAVE_1;
    return Stage.COLOSSEUM_WAVE_1 + wave;
  }

  if (
    split >= SplitType.MOKHAIOTL_DELVE_1 &&
    split <= SplitType.MOKHAIOTL_DELVE_8
  ) {
    return Stage.MOKHAIOTL_DELVE_1 + (split - SplitType.MOKHAIOTL_DELVE_1);
  }

  return Stage.UNKNOWN;
}

/**
 * The splits that are relevant for personal bests.
 */
export const RELEVANT_PB_SPLITS: SplitType[] = [
  SplitType.TOB_CHALLENGE,
  SplitType.TOB_OVERALL,
  SplitType.TOB_MAIDEN,
  SplitType.TOB_BLOAT,
  SplitType.TOB_NYLO_BOSS_SPAWN,
  SplitType.TOB_SOTETSEG,
  SplitType.TOB_NYLO_ROOM,
  SplitType.TOB_XARPUS,
  SplitType.TOB_VERZIK_ROOM,

  SplitType.COLOSSEUM_CHALLENGE,
  SplitType.COLOSSEUM_OVERALL,
  SplitType.COLOSSEUM_WAVE_1,
  SplitType.COLOSSEUM_WAVE_2,
  SplitType.COLOSSEUM_WAVE_3,
  SplitType.COLOSSEUM_WAVE_4,
  SplitType.COLOSSEUM_WAVE_5,
  SplitType.COLOSSEUM_WAVE_6,
  SplitType.COLOSSEUM_WAVE_7,
  SplitType.COLOSSEUM_WAVE_8,
  SplitType.COLOSSEUM_WAVE_9,
  SplitType.COLOSSEUM_WAVE_10,
  SplitType.COLOSSEUM_WAVE_11,
  SplitType.COLOSSEUM_WAVE_12,

  SplitType.MOKHAIOTL_CHALLENGE,
  SplitType.MOKHAIOTL_OVERALL,
  SplitType.MOKHAIOTL_DELVE_1,
  SplitType.MOKHAIOTL_DELVE_2,
  SplitType.MOKHAIOTL_DELVE_3,
  SplitType.MOKHAIOTL_DELVE_4,
  SplitType.MOKHAIOTL_DELVE_5,
  SplitType.MOKHAIOTL_DELVE_6,
  SplitType.MOKHAIOTL_DELVE_7,
  SplitType.MOKHAIOTL_DELVE_8,
].flatMap((s) => allSplitModes(s));
