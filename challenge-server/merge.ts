import { ChallengeStatus, ChallengeType, Stage } from '@blert/common';

export type ChallengeInfo = {
  id: number;
  uuid: string;
  type: ChallengeType;
  status: ChallengeStatus;
  stage: Stage;
  party: string[];
};
