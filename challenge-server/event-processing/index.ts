import {
  ChallengeMode,
  ChallengeStatus,
  ChallengeType,
  DataRepository,
  Stage,
  StageStatus,
} from '@blert/common';

import ChallengeProcessor, {
  type ChallengeState,
  InitializedFields,
  type ReportedTimes,
} from './challenge-processor';
import ColosseumProcessor from './colosseum';
import TheatreProcessor from './theatre';

export { ChallengeProcessor, ChallengeState, ReportedTimes };

export function newChallengeProcessor(
  dataRepository: DataRepository,
  uuid: string,
  type: ChallengeType,
  mode: ChallengeMode,
  stage: Stage,
  stageStatus: StageStatus,
  party: string[],
  extraFields: InitializedFields = {},
): ChallengeProcessor {
  switch (type) {
    case ChallengeType.COLOSSEUM:
      return new ColosseumProcessor(
        dataRepository,
        uuid,
        mode,
        stage,
        stageStatus,
        party,
        extraFields,
      );
    case ChallengeType.TOB:
      return new TheatreProcessor(
        dataRepository,
        uuid,
        mode,
        stage,
        stageStatus,
        party,
        extraFields,
      );

    case ChallengeType.COX:
    case ChallengeType.INFERNO:
    case ChallengeType.TOA:
      throw new Error(`Unimplemented challenge type ${type}`);

    default:
      throw new Error(`Unknown challenge type ${type}`);
  }
}

export async function loadChallengeProcessor(
  dataRepository: DataRepository,
  state: ChallengeState,
): Promise<ChallengeProcessor> {
  const reportedTimes =
    state.reportedChallengeTicks !== null && state.reportedOverallTicks !== null
      ? {
          challenge: state.reportedChallengeTicks,
          overall: state.reportedOverallTicks,
        }
      : null;

  return newChallengeProcessor(
    dataRepository,
    state.uuid,
    state.type,
    state.mode,
    state.stage,
    state.stageStatus,
    state.party,
    {
      totalDeaths: state.totalDeaths,
      challengeStatus: state.status,
      totalChallengeTicks: state.challengeTicks,
      customData: state.customData,
      reportedTimes,
    },
  );
}
