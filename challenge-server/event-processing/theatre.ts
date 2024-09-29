import {
  ChallengeMode,
  ChallengeType,
  DataRepository,
  SplitType,
  Stage,
  StageStatus,
  TobRooms,
} from '@blert/common';

import ChallengeProcessor, { InitializedFields } from './challenge-processor';
import { MergedEvents } from '../merge';

type SoteMazeState = {
  pivots: number[];
  startTick: number;
  endTick: number;
  accuratePath: boolean;
  partialPivots: number[];
};

export default class TheatreProcessor extends ChallengeProcessor {
  private rooms: TobRooms;

  private bloatDownTicks: number[];
  private stalledNyloWaves: number[];
  private soteMazes: SoteMazeState[];
  private verzikRedSpawns: number[];

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
      ChallengeType.TOB,
      Stage.TOB_MAIDEN,
      Stage.TOB_VERZIK,
      uuid,
      mode,
      stage,
      stageStatus,
      party,
      extraFields,
    );

    this.bloatDownTicks = [];
    this.stalledNyloWaves = [];
    this.soteMazes = [];
    this.verzikRedSpawns = [];

    if (extraFields.customData) {
      this.rooms = extraFields.customData as TobRooms;
    } else {
      this.rooms = {
        maiden: null,
        bloat: null,
        nylocas: null,
        sotetseg: null,
        xarpus: null,
        verzik: null,
      };
    }
  }

  protected override onCreate(): Promise<void> {
    return this.getDataRepository().saveTobChallengeData(
      this.getUuid(),
      this.rooms,
    );
  }

  protected override async onFinish(): Promise<void> {
    this.setSplit(SplitType.TOB_CHALLENGE, this.getTotalChallengeTicks());
    this.setSplit(SplitType.TOB_OVERALL, this.getOverallTicks());
  }

  protected override async onStageFinished(
    stage: Stage,
    events: MergedEvents,
  ): Promise<void> {
    const stageTicks = events.getLastTick();
    let stageSplit: SplitType;

    const stageState = this.getStageState();

    const roomData = {
      ticksLost: events.getMissingTickCount(),
      deaths: stageState?.deaths ?? [],
      npcs: Object.fromEntries(stageState?.npcs ?? []),
    };

    switch (stage) {
      case Stage.TOB_MAIDEN:
        stageSplit = SplitType.TOB_MAIDEN;
        const thirties = this.getSplit(SplitType.TOB_MAIDEN_30S);
        if (thirties !== undefined) {
          this.setSplit(SplitType.TOB_MAIDEN_30S_END, stageTicks - thirties);
        }
        this.rooms.maiden = {
          ...roomData,
          stage: Stage.TOB_MAIDEN,
        };
        break;

      case Stage.TOB_BLOAT:
        stageSplit = SplitType.TOB_BLOAT;
        this.rooms.bloat = {
          ...roomData,
          stage: Stage.TOB_BLOAT,
          downTicks: this.bloatDownTicks,
        };
        break;

      case Stage.TOB_NYLOCAS:
        stageSplit = SplitType.TOB_NYLO_ROOM;
        const bossSpawn = this.getSplit(SplitType.TOB_NYLO_BOSS_SPAWN);
        if (bossSpawn !== undefined) {
          this.setSplit(SplitType.TOB_NYLO_BOSS, stageTicks - bossSpawn);
        }
        this.rooms.nylocas = {
          ...roomData,
          stage: Stage.TOB_NYLOCAS,
          stalledWaves: this.stalledNyloWaves,
        };
        break;

      case Stage.TOB_SOTETSEG:
        stageSplit = SplitType.TOB_SOTETSEG;
        if (this.soteMazes.length == 2) {
          this.setSplit(
            SplitType.TOB_SOTETSEG_P3,
            stageTicks - this.soteMazes[1].endTick,
          );
        }
        this.rooms.sotetseg = {
          ...roomData,
          stage: Stage.TOB_SOTETSEG,
          maze1Pivots: this.soteMazes[0]?.pivots ?? [],
          maze2Pivots: this.soteMazes[1]?.pivots ?? [],
        };
        break;

      case Stage.TOB_XARPUS:
        stageSplit = SplitType.TOB_XARPUS;
        const p3Start = this.getSplit(SplitType.TOB_XARPUS_SCREECH);
        if (p3Start !== undefined) {
          this.setSplit(SplitType.TOB_XARPUS_P3, stageTicks - p3Start);
        }
        this.rooms.xarpus = {
          ...roomData,
          stage: Stage.TOB_XARPUS,
        };
        break;

      case Stage.TOB_VERZIK:
        stageSplit = SplitType.TOB_VERZIK_ROOM;
        const p2End = this.getSplit(SplitType.TOB_VERZIK_P2_END);
        if (p2End !== undefined) {
          const P2_TRANSITION_TICKS = 6;
          this.setSplit(
            SplitType.TOB_VERZIK_P3,
            stageTicks - (p2End + P2_TRANSITION_TICKS),
          );
        }
        this.rooms.verzik = {
          ...roomData,
          stage: Stage.TOB_VERZIK,
          redsSpawnCount: this.verzikRedSpawns.length,
        };
        break;
    }

    this.setSplit(stageSplit!, stageTicks);

    await this.getDataRepository().saveTobChallengeData(
      this.getUuid(),
      this.rooms,
    );
  }

  protected override getCustomData(): object | null {
    return this.rooms;
  }

  protected override hasFullyCompletedChallenge(): boolean {
    return Object.values(this.rooms).every((room) => room !== null);
  }
}
