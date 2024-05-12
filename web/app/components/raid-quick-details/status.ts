import { ChallengeStatus, Stage, stageName } from '@blert/common';

export function raidStatusNameAndColor(status: ChallengeStatus, stage: Stage) {
  if (status === ChallengeStatus.IN_PROGRESS) {
    return ['In Progress', '#FFFFFF'];
  }
  if (status === ChallengeStatus.COMPLETED) {
    return ['Completion', '#73AD70'];
  }

  let name = stageName(stage);

  if (status === ChallengeStatus.RESET) {
    return [`${name} Reset`, '#B9BBB6'];
  }
  return [`${name} Wipe`, '#B30000'];
}
