import {
  ChallengeMode,
  ChallengeType,
  ColosseumData,
  DataRepository,
  Stage,
  StageStatus,
} from '@blert/common';

import ChallengeProcessor, { InitializedFields } from './challenge-processor';

export default class ColosseumProcessor extends ChallengeProcessor {
  private colosseumData: ColosseumData;

  public constructor(
    dataRepository: DataRepository,
    uuid: string,
    mode: ChallengeMode,
    stage: Stage,
    stageStatus: StageStatus,
    party: string[],
    extraFields: InitializedFields = {},
  ) {
    super(
      dataRepository,
      uuid,
      ChallengeType.COLOSSEUM,
      mode,
      stage,
      stageStatus,
      party,
      extraFields,
    );

    this.colosseumData = {
      waves: [],
      handicaps: [],
    };
  }

  protected override onCreate(): Promise<void> {
    return this.getDataRepository().saveColosseumChallengeData(
      this.getUuid(),
      this.colosseumData,
    );
  }
}
