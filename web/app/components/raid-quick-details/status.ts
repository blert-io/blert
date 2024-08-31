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
    return ['Completion', '#73AD70'];
  }
  if (status === ChallengeStatus.ABANDONED) {
    return ['Abandoned', '#B9BBB6'];
  }

  let prefix = stage ? `${stageName(stage)} ` : '';

  if (status === ChallengeStatus.RESET) {
    return [`${prefix}Reset`, '#B9BBB6'];
  }
  return [`${prefix}Wipe`, '#B30000'];
}

export function modeNameAndColor(
  type: ChallengeType,
  difficulty: ChallengeMode,
  prefix: boolean = true,
) {
  if (type === ChallengeType.COLOSSEUM) {
    return ['Colosseum', '#33a4af'];
  }
  if (type === ChallengeType.INFERNO) {
    return ['Inferno', '#a14f1a'];
  }

  switch (difficulty) {
    case ChallengeMode.TOB_REGULAR: {
      const name = prefix ? 'ToB Regular' : 'Regular';
      return [name, '#ffd700'];
    }
    case ChallengeMode.TOB_HARD: {
      const name = prefix ? 'ToB Hard' : 'Hard';
      return [name, '#d100cc'];
    }
    case ChallengeMode.TOB_ENTRY: {
      const name = prefix ? 'ToB Entry' : 'Entry';
      return [name, '#b9bbb6'];
    }

    default:
      return ['Unknown', '#ffd700'];
  }
}
