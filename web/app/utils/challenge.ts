import {
  adjustSplitForMode,
  ChallengeMode,
  ChallengeStatus,
  ChallengeType,
  SplitType,
  Stage,
  stageName,
} from '@blert/common';

export function statusNameAndColor(status: ChallengeStatus, stage?: Stage) {
  if (status === ChallengeStatus.IN_PROGRESS) {
    return ['In Progress', 'var(--blert-status-in-progress)'];
  }
  if (status === ChallengeStatus.COMPLETED) {
    return ['Completion', 'rgba(var(--blert-green-base), 0.9)'];
  }
  if (status === ChallengeStatus.ABANDONED) {
    return ['Abandoned', 'var(--blert-status-abandoned)'];
  }

  const prefix = stage ? `${stageName(stage)} ` : '';

  if (status === ChallengeStatus.RESET) {
    return [`${prefix}Reset`, 'var(--blert-status-reset)'];
  }
  return [`${prefix}Wipe`, 'rgba(var(--blert-red-base), 0.9)'];
}

export function modeName(
  type: ChallengeType,
  difficulty: ChallengeMode,
  prefix: boolean = true,
  short: boolean = false,
): string {
  if (type === ChallengeType.COLOSSEUM) {
    return short ? 'COL' : 'Colosseum';
  }
  if (type === ChallengeType.INFERNO) {
    return short ? 'INF' : 'Inferno';
  }
  if (type === ChallengeType.MOKHAIOTL) {
    return short ? 'MOK' : 'Mokhaiotl';
  }

  switch (difficulty) {
    case ChallengeMode.TOB_REGULAR:
      if (short) {
        return 'TOB';
      }
      return prefix ? 'ToB Regular' : 'Regular';
    case ChallengeMode.TOB_HARD:
      if (short) {
        return 'HMT';
      }
      return prefix ? 'ToB Hard' : 'Hard';
    case ChallengeMode.TOB_ENTRY:
      if (short) {
        return 'ENT';
      }
      return prefix ? 'ToB Entry' : 'Entry';
    default:
      return short ? 'UNK' : 'Unknown';
  }
}

/** Returns the identity slug for a challenge. */
export function challengeSlug(
  type: ChallengeType,
  mode: ChallengeMode = ChallengeMode.NO_MODE,
): string {
  if (type === ChallengeType.COLOSSEUM) {
    return 'col';
  }
  if (type === ChallengeType.INFERNO) {
    return 'inf';
  }
  if (type === ChallengeType.MOKHAIOTL) {
    return 'mok';
  }

  switch (mode) {
    case ChallengeMode.TOB_HARD:
      return 'hmt';
    case ChallengeMode.TOB_REGULAR:
    case ChallengeMode.NO_MODE:
      return type === ChallengeType.TOB ? 'tob' : 'unk';
    default:
      return 'unk';
  }
}

const SCALE_NAME_AND_COLOR: [string, string][] = [
  ['Solo', 'var(--blert-scale-1)'],
  ['Duo', 'var(--blert-scale-2)'],
  ['Trio', 'var(--blert-scale-3)'],
  ['4s', 'var(--blert-scale-4)'],
  ['5s', 'var(--blert-scale-5)'],
];

export function scaleNameAndColor(scale: number): [string, string] {
  return SCALE_NAME_AND_COLOR[scale - 1] ?? ['Unknown', '#c3c7c9'];
}

/**
 * Returns the appropriate term for a challenge attempt based on its type.
 *
 * @param type The type of challenge.
 * @param plural Whether to return the plural form.
 * @returns The appropriate term for the challenge attempt.
 */
export function challengeTerm(type: ChallengeType, plural: boolean = false) {
  if (
    type === ChallengeType.COLOSSEUM ||
    type === ChallengeType.INFERNO ||
    type === ChallengeType.MOKHAIOTL
  ) {
    return plural ? 'Runs' : 'Run';
  }
  return plural ? 'Raids' : 'Raid';
}

/**
 * Returns the appropriate term for a challenge's stages based on its type.
 *
 * @param type The type of challenge.
 * @param plural Whether to return the plural form.
 * @returns The appropriate term for the stages.
 */
export function stageTerm(type: ChallengeType, plural: boolean = false) {
  if (type === ChallengeType.COLOSSEUM || type === ChallengeType.INFERNO) {
    return plural ? 'Waves' : 'Wave';
  }
  if (type === ChallengeType.MOKHAIOTL) {
    return plural ? 'Delves' : 'Delve';
  }
  return plural ? 'Rooms' : 'Room';
}

export function relevantSplitsForStage(
  stage: Stage,
  mode: ChallengeMode = ChallengeMode.NO_MODE,
): SplitType[] {
  let splits: SplitType[] = [];

  switch (stage) {
    case Stage.TOB_MAIDEN:
      splits = [
        SplitType.TOB_MAIDEN,
        SplitType.TOB_MAIDEN_70S,
        SplitType.TOB_MAIDEN_50S,
        SplitType.TOB_MAIDEN_30S,
      ];
      break;

    case Stage.TOB_BLOAT:
      splits = [SplitType.TOB_BLOAT];
      break;

    case Stage.TOB_NYLOCAS:
      splits = [
        SplitType.TOB_NYLO_ROOM,
        SplitType.TOB_NYLO_BOSS_SPAWN,
        SplitType.TOB_NYLO_BOSS,
      ];
      break;
    case Stage.TOB_SOTETSEG:
      splits = [
        SplitType.TOB_SOTETSEG,
        SplitType.TOB_SOTETSEG_66,
        SplitType.TOB_SOTETSEG_33,
      ];
      break;

    case Stage.TOB_XARPUS:
      splits = [SplitType.TOB_XARPUS, SplitType.TOB_XARPUS_SCREECH];
      break;

    case Stage.TOB_VERZIK:
      splits = [
        SplitType.TOB_VERZIK_ROOM,
        SplitType.TOB_VERZIK_P1,
        SplitType.TOB_VERZIK_REDS,
        SplitType.TOB_VERZIK_P2,
      ];
      break;

    case Stage.INFERNO_WAVE_9:
      splits = [SplitType.INFERNO_WAVE_9_START];
      break;
    case Stage.INFERNO_WAVE_18:
      splits = [SplitType.INFERNO_WAVE_18_START];
      break;
    case Stage.INFERNO_WAVE_25:
      splits = [SplitType.INFERNO_WAVE_25_START];
      break;
    case Stage.INFERNO_WAVE_35:
      splits = [SplitType.INFERNO_WAVE_35_START];
      break;
    case Stage.INFERNO_WAVE_42:
      splits = [SplitType.INFERNO_WAVE_42_START];
      break;
    case Stage.INFERNO_WAVE_50:
      splits = [SplitType.INFERNO_WAVE_50_START];
      break;
    case Stage.INFERNO_WAVE_57:
      splits = [SplitType.INFERNO_WAVE_57_START];
      break;
    case Stage.INFERNO_WAVE_60:
      splits = [SplitType.INFERNO_WAVE_60_START];
      break;
    case Stage.INFERNO_WAVE_63:
      splits = [SplitType.INFERNO_WAVE_63_START];
      break;
    case Stage.INFERNO_WAVE_66:
      splits = [SplitType.INFERNO_WAVE_66_START];
      break;
    case Stage.INFERNO_WAVE_68:
      splits = [SplitType.INFERNO_WAVE_68_START];
      break;
    case Stage.INFERNO_WAVE_69:
      splits = [SplitType.INFERNO_WAVE_69_START];
      break;

    case Stage.COLOSSEUM_WAVE_1:
    case Stage.COLOSSEUM_WAVE_2:
    case Stage.COLOSSEUM_WAVE_3:
    case Stage.COLOSSEUM_WAVE_4:
    case Stage.COLOSSEUM_WAVE_5:
    case Stage.COLOSSEUM_WAVE_6:
    case Stage.COLOSSEUM_WAVE_7:
    case Stage.COLOSSEUM_WAVE_8:
    case Stage.COLOSSEUM_WAVE_9:
    case Stage.COLOSSEUM_WAVE_10:
    case Stage.COLOSSEUM_WAVE_11:
    case Stage.COLOSSEUM_WAVE_12:
      const wave = stage - Stage.COLOSSEUM_WAVE_1;
      splits = [SplitType.COLOSSEUM_WAVE_1 + wave];
      break;

    case Stage.MOKHAIOTL_DELVE_1:
    case Stage.MOKHAIOTL_DELVE_2:
    case Stage.MOKHAIOTL_DELVE_3:
    case Stage.MOKHAIOTL_DELVE_4:
    case Stage.MOKHAIOTL_DELVE_5:
    case Stage.MOKHAIOTL_DELVE_6:
    case Stage.MOKHAIOTL_DELVE_7:
    case Stage.MOKHAIOTL_DELVE_8:
      const delve = stage - Stage.MOKHAIOTL_DELVE_1;
      splits = [SplitType.MOKHAIOTL_DELVE_1 + delve];
      break;

    default:
      break;
  }

  return splits.map((split) => adjustSplitForMode(split, mode));
}
