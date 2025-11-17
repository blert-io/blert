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
    return ['In Progress', '#FFFFFF'];
  }
  if (status === ChallengeStatus.COMPLETED) {
    return ['Completion', 'rgba(var(--blert-green-base), 0.9)'];
  }
  if (status === ChallengeStatus.ABANDONED) {
    return ['Abandoned', '#b9bbb6'];
  }

  const prefix = stage ? `${stageName(stage)} ` : '';

  if (status === ChallengeStatus.RESET) {
    return [`${prefix}Reset`, 'var(--blert-text-color)'];
  }
  return [`${prefix}Wipe`, 'rgba(var(--blert-red-base), 0.9)'];
}

export function modeNameAndColor(
  type: ChallengeType,
  difficulty: ChallengeMode,
  prefix: boolean = true,
  short: boolean = false,
) {
  if (type === ChallengeType.COLOSSEUM) {
    return [short ? 'COL' : 'Colosseum', '#33a4af'];
  }
  if (type === ChallengeType.INFERNO) {
    return [short ? 'INF' : 'Inferno', '#a14f1a'];
  }
  if (type === ChallengeType.MOKHAIOTL) {
    return [short ? 'MOK' : 'Mokhaiotl', '#c16056'];
  }

  switch (difficulty) {
    case ChallengeMode.TOB_REGULAR: {
      let name;
      if (short) {
        name = 'TOB';
      } else {
        name = prefix ? 'ToB Regular' : 'Regular';
      }
      return [name, '#d4ba2b'];
    }
    case ChallengeMode.TOB_HARD: {
      let name;
      if (short) {
        name = 'HMT';
      } else {
        name = prefix ? 'ToB Hard' : 'Hard';
      }
      return [name, '#b713b4'];
    }
    case ChallengeMode.TOB_ENTRY: {
      let name;
      if (short) {
        name = 'ENT';
      } else {
        name = prefix ? 'ToB Entry' : 'Entry';
      }
      return [name, '#b9bbb6'];
    }

    default:
      return [short ? 'UNK' : 'Unknown', '#c3c7c9'];
  }
}

const SCALE_NAME_AND_COLOR: [string, string][] = [
  ['Solo', '#0088fe'],
  ['Duo', '#00c49f'],
  ['Trio', '#ffbb28'],
  ['4s', '#ff8042'],
  ['5s', '#8884d8'],
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
