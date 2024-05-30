import {
  ChallengeMode,
  ChallengeStatus,
  ChallengeType,
  ColosseumData,
  DataRepository,
  HANDICAP_LEVEL_VALUE_INCREMENT,
  Handicap,
  SplitType,
  Stage,
  StageStatus,
} from '@blert/common';
import { Event } from '@blert/common/generated/event_pb';

import { Challenge } from './challenge';

export default class ColosseumChallenge extends Challenge {
  private colosseumData: ColosseumData;
  private handicapLevels: number[];
  private selectedHandicap: Handicap | null;
  private waveHandicapOptions: Handicap[];

  constructor(
    dataRepository: DataRepository,
    id: string,
    party: string[],
    startTime: number,
  ) {
    super(
      dataRepository,
      ChallengeType.COLOSSEUM,
      id,
      ChallengeMode.NO_MODE,
      party,
      startTime,
      Stage.COLOSSEUM_WAVE_1,
    );

    this.colosseumData = {
      waves: [],
      handicaps: [],
    };
    this.handicapLevels = Array(14).fill(0);
    this.selectedHandicap = null;
    this.waveHandicapOptions = [];
  }

  protected override async onInitialize(): Promise<void> {
    await this.getDataRepository().saveColosseumChallengeData(
      this.getId(),
      this.colosseumData,
    );
  }

  protected override async onFinish(): Promise<void> {
    console.log(`Colosseum challenge ${this.getId()} finished`);
    this.setSplit(SplitType.COLOSSEUM_CHALLENGE, this.getTotalStageTicks());
  }

  protected override async onStageEntered(): Promise<void> {
    this.resetWave();
  }

  protected override async onStageFinished(
    event: Event,
    stageUpdate: Event.StageUpdate,
  ): Promise<void> {
    this.colosseumData.waves.push({
      stage: this.getStage(),
      // TODO(frolv): Track tick loss.
      ticksLost: 0,
      handicap: this.selectedHandicap ?? 0,
      options: this.waveHandicapOptions,
      npcs: Object.fromEntries(this.getStageNpcs()),
    });

    const promises: Promise<any>[] = [
      this.getDataRepository().saveColosseumChallengeData(
        this.getId(),
        this.colosseumData,
      ),
    ];

    // Set the status if the challenge were to be finished at this point.
    if (stageUpdate.getStatus() === StageStatus.WIPED) {
      this.setChallengeStatus(ChallengeStatus.WIPED);
      // TODO(frolv): Send PLAYER_DEATH events in colosseum.
      promises.push(this.updateChallenge({ totalDeaths: 1 }));
    } else if (this.getStage() === Stage.COLOSSEUM_WAVE_12) {
      this.setChallengeStatus(ChallengeStatus.COMPLETED);
    } else {
      this.setChallengeStatus(ChallengeStatus.RESET);
    }

    if (stageUpdate.getStatus() === StageStatus.COMPLETED) {
      this.setSplit(
        SplitType.COLOSSEUM_WAVE_1 + this.getWaveIndex(),
        event.getTick(),
      );
    }

    await Promise.all(promises);
    return;
  }

  protected override async processChallengeEvent(
    event: Event,
  ): Promise<boolean> {
    if (event.getType() === Event.Type.COLOSSEUM_HANDICAP_CHOICE) {
      const handicap = event.getHandicap();

      this.selectedHandicap = this.levelHandicap(handicap);
      this.waveHandicapOptions = event
        .getHandicapOptionsList()
        .map(this.levelHandicap, this);

      this.handicapLevels[handicap]++;

      const index = this.colosseumData.handicaps.indexOf(
        (this.selectedHandicap as number) - HANDICAP_LEVEL_VALUE_INCREMENT,
      );
      if (index !== -1) {
        this.colosseumData.handicaps[index] += HANDICAP_LEVEL_VALUE_INCREMENT;
      } else {
        this.colosseumData.handicaps.push(handicap);
      }
    }
    return true;
  }

  protected override hasFullyCompletedChallenge(): boolean {
    return this.colosseumData.waves.length === 12;
  }

  /**
   * Adjusts a handicap's ID based on the level of the handicap.
   * @param handicap The base handicap ID.
   * @returns The leveled handicap ID.
   */
  private levelHandicap(handicap: number): Handicap {
    const increment =
      this.handicapLevels[handicap] * HANDICAP_LEVEL_VALUE_INCREMENT;
    return handicap + increment;
  }

  private getWaveIndex(): number {
    return this.getStage() - Stage.COLOSSEUM_WAVE_1;
  }

  private resetWave(): void {
    this.selectedHandicap = null;
    this.waveHandicapOptions = [];
  }
}
