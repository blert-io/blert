import {
  ChallengeMode,
  ChallengeType,
  DataRepository,
  Stage,
  StageStatus,
  TobRooms,
} from '@blert/common';

import ChallengeProcessor, { InitializedFields } from './challenge-processor';

export default class TheatreProcessor extends ChallengeProcessor {
  private rooms: TobRooms;

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
      ChallengeType.TOB,
      mode,
      stage,
      stageStatus,
      party,
      extraFields,
    );

    this.rooms = {
      maiden: null,
      bloat: null,
      nylocas: null,
      sotetseg: null,
      xarpus: null,
      verzik: null,
    };
  }

  protected override onCreate(): Promise<void> {
    return this.getDataRepository().saveTobChallengeData(
      this.getUuid(),
      this.rooms,
    );
  }
}
