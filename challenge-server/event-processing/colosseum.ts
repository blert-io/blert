import {
  ChallengeMode,
  ChallengeType,
  ColosseumData,
  DataRepository,
  Handicap,
  SplitType,
  Stage,
  StageStatus,
} from '@blert/common';

import ChallengeProcessor, { InitializedFields } from './challenge-processor';
import { MergedEvents } from '../merge';

function waveIndex(stage: Stage): number {
  return stage - Stage.COLOSSEUM_WAVE_1;
}

export default class ColosseumProcessor extends ChallengeProcessor {
  private colosseumData: ColosseumData;

  private selectedHandicap: Handicap | null;
  private waveHandicapOptions: Handicap[];

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
      ChallengeType.COLOSSEUM,
      Stage.COLOSSEUM_WAVE_1,
      Stage.COLOSSEUM_WAVE_12,
      uuid,
      mode,
      stage,
      stageStatus,
      party,
      extraFields,
    );

    this.selectedHandicap = null;
    this.waveHandicapOptions = [];

    if (extraFields.customData) {
      this.colosseumData = extraFields.customData as ColosseumData;
    } else {
      this.colosseumData = {
        waves: [],
        handicaps: [],
      };
    }
  }

  protected override onCreate(): Promise<void> {
    return this.getDataRepository().saveColosseumChallengeData(
      this.getUuid(),
      this.colosseumData,
    );
  }

  protected override async onFinish(): Promise<void> {
    this.setSplit(SplitType.COLOSSEUM_CHALLENGE, this.getTotalChallengeTicks());
  }

  protected override async onStageFinished(
    stage: Stage,
    events: MergedEvents,
  ): Promise<void> {
    const state = this.getStageState();

    this.colosseumData.waves.push({
      stage,
      ticksLost: events.getMissingTickCount(),
      handicap: this.selectedHandicap ?? 0,
      options: this.waveHandicapOptions,
      npcs: Object.fromEntries(state?.npcs ?? []),
    });

    this.setSplit(
      SplitType.COLOSSEUM_WAVE_1 + waveIndex(stage),
      events.getLastTick(),
    );

    await this.getDataRepository().saveColosseumChallengeData(
      this.getUuid(),
      this.colosseumData,
    );
  }

  protected override getCustomData(): object | null {
    return this.colosseumData;
  }

  protected override hasFullyCompletedChallenge(): boolean {
    return this.colosseumData.waves.length === 12;
  }
}
