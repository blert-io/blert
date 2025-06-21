import {
  ChallengeMode,
  ChallengeStatus,
  ChallengeType,
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

  let prefix = stage ? `${stageName(stage)} ` : '';

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

const SCALE_NAME_AND_COLOR: Array<[string, string]> = [
  ['Solo', '#0088fe'],
  ['Duo', '#00c49f'],
  ['Trio', '#ffbb28'],
  ['4s', '#ff8042'],
  ['5s', '#8884d8'],
];

export function scaleNameAndColor(scale: number): [string, string] {
  return SCALE_NAME_AND_COLOR[scale - 1] ?? ['Unknown', '#c3c7c9'];
}
