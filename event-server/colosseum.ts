import {
  ChallengeMode,
  ChallengeStatus,
  ChallengeType,
  HANDICAP_LEVEL_VALUE_INCREMENT,
  Handicap,
  PersonalBestType,
  RaidDocument,
  RoomNpc,
  Stage,
  StageStatus,
} from '@blert/common';
import { Event } from '@blert/common/generated/event_pb';

import { Challenge } from './challenge';
import { Players } from './players';

export default class ColosseumChallenge extends Challenge {
  private handicapLevels: number[];
  private selectedHandicap: Handicap | null;
  private waveHandicapOptions: Handicap[];
  private waveNpcs: Map<number, RoomNpc>;

  constructor(id: string, party: string[], startTime: number) {
    super(
      ChallengeType.COLOSSEUM,
      id,
      ChallengeMode.NO_MODE,
      party,
      startTime,
      Stage.COLOSSEUM_WAVE_1,
    );

    this.handicapLevels = Array(14).fill(0);
    this.selectedHandicap = null;
    this.waveHandicapOptions = [];
    this.waveNpcs = new Map();
  }

  protected override async onInitialize(document: RaidDocument): Promise<void> {
    document.colosseum = {
      handicaps: [],
      waves: [],
    };
  }

  protected override async onFinish(): Promise<void> {
    console.log(`Colosseum challenge ${this.getId()} finished`);

    if (this.getChallengeStatus() === ChallengeStatus.COMPLETED) {
      Players.updatePersonalBests(
        this.getParty(),
        this.getId(),
        PersonalBestType.COLOSSEUM_CHALLENGE,
        this.getStage(),
        this.getTotalStageTicks(),
      );
    }
  }

  protected override async onStageEntered(): Promise<void> {
    this.resetWave();
  }

  protected override async onStageFinished(
    event: Event,
    stageUpdate: Event.StageUpdate,
  ): Promise<void> {
    const promises = [];

    promises.push(
      this.updateDatabaseFields((document) => {
        document.colosseum.waves.push({
          ticks: event.getTick(),
          handicap: this.selectedHandicap ?? 0,
          options: this.waveHandicapOptions,
          // @ts-ignore: NPCs are a map in the database.
          npcs: this.waveNpcs,
        });
      }),
    );

    // Set the status if the challenge were to be finished at this point.
    if (stageUpdate.getStatus() === StageStatus.WIPED) {
      this.setChallengeStatus(ChallengeStatus.WIPED);
      // TODO(frolv): Handle deaths generally.
      promises.push(
        this.updateDatabaseFields((document) => {
          document.totalDeaths = 1;
        }),
      );
    } else if (this.getStage() === Stage.COLOSSEUM_WAVE_12) {
      this.setChallengeStatus(ChallengeStatus.COMPLETED);
    } else {
      this.setChallengeStatus(ChallengeStatus.RESET);
    }

    if (stageUpdate.getStatus() === StageStatus.COMPLETED) {
      const stagePb = PersonalBestType.COLOSSEUM_WAVE_1 + this.getWaveIndex();

      promises.push(
        Players.updatePersonalBests(
          this.getParty(),
          this.getId(),
          stagePb,
          1,
          event.getTick(),
        ),
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

      await this.updateDatabaseFields((document) => {
        const index = document.colosseum.handicaps.indexOf(
          (this.selectedHandicap as number) - HANDICAP_LEVEL_VALUE_INCREMENT,
        );
        if (index !== -1) {
          document.colosseum.handicaps[index] += HANDICAP_LEVEL_VALUE_INCREMENT;
        } else {
          document.colosseum.handicaps.push(handicap);
        }
      });
    }
    return true;
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
    this.waveNpcs.clear();
  }
}
