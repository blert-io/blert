import {
  ChallengeType,
  isTfaStage,
  stagesForChallenge,
  TfaStage,
} from '@blert/common';

import { stagePath } from './url';

export function tfaBossFromToken(token: string): TfaStage | null {
  for (const stage of stagesForChallenge(ChallengeType.TFA)) {
    if (
      isTfaStage(stage) &&
      (stagePath(stage) === token || String(stage) === token)
    ) {
      return stage;
    }
  }
  return null;
}
