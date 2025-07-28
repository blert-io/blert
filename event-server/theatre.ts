import {
  AttackStyle,
  ChallengeMode,
  ChallengeStatus,
  ChallengeType,
  DataRepository,
  EventType,
  MaidenCrabSpawn,
  Maze,
  Npc,
  NpcAttack,
  PlayerAttack,
  SplitType,
  Stage,
  StageStatus,
  TobRooms,
  VerzikPhase,
  XarpusPhase,
} from '@blert/common';
import { Event, NpcAttackMap } from '@blert/common/generated/event_pb';

import { Challenge, StageUpdate } from './challenge';
import { priceTracker } from './price-tracker';

type Proto<T> = T[keyof T];

type SoteMazeState = {
  pivots: number[];
  startTick: number;
  endTick: number;
  accuratePath: boolean;
  partialPivots: number[];
};

export default class TheatreChallenge extends Challenge {
  private rooms: TobRooms;

  private bloatDownTicks: number[];
  private stalledNyloWaves: number[];
  private soteMazes: SoteMazeState[];
  private verzikRedSpawns: number[];

  public constructor(
    dataRepository: DataRepository,
    id: string,
    party: string[],
    mode: ChallengeMode,
    startTime: number,
  ) {
    super(
      dataRepository,
      ChallengeType.TOB,
      id,
      mode,
      party,
      startTime,
      Stage.TOB_MAIDEN,
    );

    this.rooms = {
      maiden: null,
      bloat: null,
      nylocas: null,
      sotetseg: null,
      xarpus: null,
      verzik: null,
    };

    this.bloatDownTicks = [];
    this.stalledNyloWaves = [];
    this.soteMazes = [];
    this.verzikRedSpawns = [];
  }

  protected override async onInitialize(): Promise<void> {
    this.getDataRepository().saveTobChallengeData(this.getId(), this.rooms);
  }

  protected override async onFinish(): Promise<void> {
    this.setSplit(SplitType.TOB_CHALLENGE, this.getTotalStageTicks());
    this.setSplit(SplitType.TOB_OVERALL, this.getOverallTime());

    for (const username of this.getParty()) {
      const stats = this.getCurrentStageStats(username);
      switch (this.getChallengeStatus()) {
        case ChallengeStatus.COMPLETED:
          stats.tobCompletions += 1;
          break;
        case ChallengeStatus.RESET:
          stats.tobResets += 1;
          break;
        case ChallengeStatus.WIPED:
          stats.tobWipes += 1;
          break;
      }
    }
  }

  protected override async onStageEntered(): Promise<void> {}

  protected override async onStageFinished(
    update: StageUpdate,
    stageTicks: number,
  ): Promise<void> {
    // Set the appropriate status if the raid were to be finished at this
    // point.
    if (update.status === StageStatus.WIPED) {
      this.setChallengeStatus(ChallengeStatus.WIPED);
    } else if (this.getStage() === Stage.TOB_VERZIK) {
      this.setChallengeStatus(ChallengeStatus.COMPLETED);
    } else {
      this.setChallengeStatus(ChallengeStatus.RESET);
    }

    let ticksLost = 0;
    if (!update.accurate) {
      const missingTicks = stageTicks - this.getStageTick();
      ticksLost = missingTicks;

      if (missingTicks > 0) {
        console.log(
          `Raid ${this.getId()} lost ${missingTicks} ticks at stage ${update.stage}`,
        );
        // TODO(frolv): This should be handled outside of the challenge itself,
        // instead of assuming tick loss at the start.
        // this.correctRoomDataForTickOffset(missingTicks);
      }
    }

    switch (update.stage) {
      case Stage.TOB_MAIDEN:
        this.rooms.maiden = {
          stage: Stage.TOB_MAIDEN,
          ticksLost,
          deaths: this.getStageDeaths(),
          npcs: Object.fromEntries(this.getStageNpcs()),
        };
        break;
      case Stage.TOB_BLOAT:
        this.rooms.bloat = {
          stage: Stage.TOB_BLOAT,
          ticksLost,
          deaths: this.getStageDeaths(),
          npcs: Object.fromEntries(this.getStageNpcs()),
          downTicks: this.bloatDownTicks,
        };
        break;
      case Stage.TOB_NYLOCAS:
        this.rooms.nylocas = {
          stage: Stage.TOB_NYLOCAS,
          ticksLost,
          deaths: this.getStageDeaths(),
          npcs: Object.fromEntries(this.getStageNpcs()),
          stalledWaves: this.stalledNyloWaves,
        };
        break;
      case Stage.TOB_SOTETSEG:
        this.rooms.sotetseg = {
          stage: Stage.TOB_SOTETSEG,
          ticksLost,
          deaths: this.getStageDeaths(),
          npcs: Object.fromEntries(this.getStageNpcs()),
          maze1Pivots: this.soteMazes[0]?.pivots ?? [],
          maze2Pivots: this.soteMazes[1]?.pivots ?? [],
          maze1Chosen: null,
          maze2Chosen: null,
        };
        break;
      case Stage.TOB_XARPUS:
        this.rooms.xarpus = {
          stage: Stage.TOB_XARPUS,
          ticksLost,
          deaths: this.getStageDeaths(),
          npcs: Object.fromEntries(this.getStageNpcs()),
        };
        break;
      case Stage.TOB_VERZIK:
        this.rooms.verzik = {
          stage: Stage.TOB_VERZIK,
          ticksLost,
          deaths: this.getStageDeaths(),
          npcs: Object.fromEntries(this.getStageNpcs()),
          redsSpawnCount: this.verzikRedSpawns.length,
        };
        break;
    }

    let stageSplit: SplitType;

    switch (this.getStage()) {
      case Stage.TOB_MAIDEN:
        stageSplit = SplitType.TOB_MAIDEN;
        const thirties = this.getSplit(SplitType.TOB_MAIDEN_30S);
        if (thirties !== undefined) {
          this.setSplit(SplitType.TOB_MAIDEN_30S_END, stageTicks - thirties);
        }
        break;

      case Stage.TOB_BLOAT:
        stageSplit = SplitType.TOB_BLOAT;
        break;

      case Stage.TOB_NYLOCAS:
        stageSplit = SplitType.TOB_NYLO_ROOM;
        const bossSpawn = this.getSplit(SplitType.TOB_NYLO_BOSS_SPAWN);
        if (bossSpawn !== undefined) {
          this.setSplit(SplitType.TOB_NYLO_BOSS, stageTicks - bossSpawn);
        }
        break;

      case Stage.TOB_SOTETSEG:
        stageSplit = SplitType.TOB_SOTETSEG;
        if (this.soteMazes.length == 2) {
          this.setSplit(
            SplitType.TOB_SOTETSEG_P3,
            stageTicks - this.soteMazes[1].endTick,
          );
        }
        break;
      case Stage.TOB_XARPUS:
        stageSplit = SplitType.TOB_XARPUS;
        const p3Start = this.getSplit(SplitType.TOB_XARPUS_SCREECH);
        if (p3Start !== undefined) {
          this.setSplit(SplitType.TOB_XARPUS_P3, stageTicks - p3Start);
        }
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
        break;
    }

    this.setSplit(stageSplit!, stageTicks);

    await this.getDataRepository().saveTobChallengeData(
      this.getId(),
      this.rooms,
    );
  }

  protected override hasFullyCompletedChallenge(): boolean {
    return Object.values(this.rooms).every((room) => room !== null);
  }

  /**
   * Updates the state of the raid from a received event.
   *
   * @param event The event that occurred.
   * @returns true if the event should be written to the database, false if not.
   */
  protected override async processChallengeEvent(
    event: Event,
  ): Promise<boolean> {
    switch (event.getType()) {
      case Event.Type.PLAYER_UPDATE:
        this.tryDetermineGear(event.getPlayer()!);
        return true;

      case Event.Type.PLAYER_DEATH:
        const deadPlayer = event.getPlayer()!;

        const stats = this.getCurrentStageStats(deadPlayer.getName());
        stats.deathsTotal += 1;

        if (event.getStage() === Stage.TOB_MAIDEN) {
          stats.deathsMaiden += 1;
        } else if (event.getStage() === Stage.TOB_BLOAT) {
          stats.deathsBloat += 1;
        } else if (event.getStage() === Stage.TOB_NYLOCAS) {
          stats.deathsNylocas += 1;
        } else if (event.getStage() === Stage.TOB_SOTETSEG) {
          stats.deathsSotetseg += 1;
        } else if (event.getStage() === Stage.TOB_XARPUS) {
          stats.deathsXarpus += 1;
        } else if (event.getStage() === Stage.TOB_VERZIK) {
          stats.deathsVerzik += 1;
        }
        break;

      case EventType.PLAYER_ATTACK:
        await this.handlePlayerAttack(event);
        break;

      case EventType.NPC_SPAWN:
        const npc = event.getNpc()!;
        if (Npc.isVerzikMatomenos(npc.getId())) {
          if (this.verzikRedSpawns.length === 0) {
            // First red spawn is recorded as a stage split.
            this.setSplit(SplitType.TOB_VERZIK_REDS, event.getTick());
            this.verzikRedSpawns.push(event.getTick());
          } else if (
            this.verzikRedSpawns[this.verzikRedSpawns.length - 1] !==
            event.getTick()
          ) {
            // A new spawn occurred.
            this.verzikRedSpawns.push(event.getTick());
          }
        }

        if (npc.hasMaidenCrab()) {
          switch (npc.getMaidenCrab()!.getSpawn()) {
            case MaidenCrabSpawn.SEVENTIES:
              this.setSplit(SplitType.TOB_MAIDEN_70S, event.getTick());
              break;
            case MaidenCrabSpawn.FIFTIES:
              this.setSplit(SplitType.TOB_MAIDEN_50S, event.getTick());
              const seventies = this.getSplit(SplitType.TOB_MAIDEN_70S);
              if (seventies !== undefined) {
                this.setSplit(
                  SplitType.TOB_MAIDEN_70S_50S,
                  event.getTick() - seventies,
                );
              }
              break;
            case MaidenCrabSpawn.THIRTIES:
              this.setSplit(SplitType.TOB_MAIDEN_30S, event.getTick());
              const fifties = this.getSplit(SplitType.TOB_MAIDEN_50S);
              if (fifties !== undefined) {
                this.setSplit(
                  SplitType.TOB_MAIDEN_50S_30S,
                  event.getTick() - fifties,
                );
              }
              break;
          }
        }
        break;

      case EventType.TOB_BLOAT_DOWN:
        this.bloatDownTicks.push(event.getTick());
        break;

      case EventType.TOB_NYLO_WAVE_SPAWN:
        const spawnedWave = event.getNyloWave()!.getWave();
        if (spawnedWave === 20) {
          this.setSplit(SplitType.TOB_NYLO_CAP, event.getTick());
        } else if (spawnedWave === 31) {
          this.setSplit(SplitType.TOB_NYLO_WAVES, event.getTick());
        }
        break;

      case EventType.TOB_NYLO_WAVE_STALL:
        const stalledWave = event.getNyloWave()!.getWave();
        this.stalledNyloWaves.push(stalledWave);
        break;

      case EventType.TOB_NYLO_CLEANUP_END:
        this.setSplit(SplitType.TOB_NYLO_CLEANUP, event.getTick());
        break;

      case EventType.TOB_NYLO_BOSS_SPAWN:
        this.setSplit(SplitType.TOB_NYLO_BOSS_SPAWN, event.getTick());
        break;

      case EventType.TOB_SOTE_MAZE_PROC: {
        const maze = event.getSoteMaze()!.getMaze();
        if (maze === Maze.MAZE_66) {
          this.setSplit(SplitType.TOB_SOTETSEG_66, event.getTick());
        } else {
          this.setSplit(SplitType.TOB_SOTETSEG_33, event.getTick());
          if (this.soteMazes.length > 0) {
            const maze1End = this.soteMazes[0].endTick;
            this.setSplit(
              SplitType.TOB_SOTETSEG_P2,
              event.getTick() - maze1End,
            );
          }
        }
        this.soteMazes.push({
          pivots: [],
          startTick: event.getTick(),
          endTick: 0,
          accuratePath: false,
          partialPivots: Array(8).fill(-1),
        });
        break;
      }

      case EventType.TOB_SOTE_MAZE_PATH: {
        const soteMaze = event.getSoteMaze()!;
        if (soteMaze.getOverworldTilesList().length > 0) {
          return true;
        }

        // Update the maze path and don't write the event.
        this.handleSoteMazePath(soteMaze);
        return false;
      }

      case EventType.TOB_SOTE_MAZE_END: {
        const maze = event.getSoteMaze()!.getMaze();
        const activeMaze = this.soteMazes[this.soteMazes.length - 1];
        activeMaze.endTick = event.getTick();

        if (maze === Maze.MAZE_66) {
          this.setSplit(
            SplitType.TOB_SOTETSEG_MAZE_1,
            event.getTick() - activeMaze.startTick,
          );
        } else {
          this.setSplit(
            SplitType.TOB_SOTETSEG_MAZE_2,
            event.getTick() - activeMaze.startTick,
          );
        }
        return false;
      }

      case EventType.TOB_XARPUS_PHASE:
        const xarpusPhase = event.getXarpusPhase();
        if (xarpusPhase === XarpusPhase.P2) {
          this.setSplit(SplitType.TOB_XARPUS_EXHUMES, event.getTick());
        } else if (xarpusPhase === XarpusPhase.P3) {
          this.setSplit(SplitType.TOB_XARPUS_SCREECH, event.getTick());
          const p2Start = this.getSplit(SplitType.TOB_XARPUS_EXHUMES);
          if (p2Start !== undefined) {
            this.setSplit(SplitType.TOB_XARPUS_P2, event.getTick() - p2Start);
          }
        }
        break;

      case EventType.TOB_VERZIK_PHASE:
        const verzikPhase = event.getVerzikPhase();
        if (verzikPhase === VerzikPhase.P2) {
          this.setSplit(SplitType.TOB_VERZIK_P1_END, event.getTick());
        } else if (verzikPhase === VerzikPhase.P3) {
          this.setSplit(SplitType.TOB_VERZIK_P2_END, event.getTick());
          const p1End = this.getSplit(SplitType.TOB_VERZIK_P1_END);
          if (p1End !== undefined) {
            const P1_TRANSITION_TICKS = 13;
            this.setSplit(
              SplitType.TOB_VERZIK_P2,
              event.getTick() - (p1End + P1_TRANSITION_TICKS),
            );
          }
        }
        break;

      case EventType.TOB_VERZIK_ATTACK_STYLE: {
        // Update the previously-written NPC_ATTACK event.
        const verzikAttackStyle = event.getVerzikAttackStyle()!;

        const attackEvent = this.getStageEvents(
          verzikAttackStyle.getNpcAttackTick(),
        ).find(
          (e) =>
            e.getType() === EventType.NPC_ATTACK &&
            e.getNpcAttack()!.getAttack() === NpcAttack.TOB_VERZIK_P3_AUTO,
        );

        if (attackEvent === undefined) {
          console.log(
            `Raid ${this.getId()} got VERZIK_ATTACK_STYLE without a matching NPC_ATTACK`,
          );
          return false;
        }

        const npcAttack = attackEvent.getNpcAttack()!;

        let attackType: NpcAttack;
        switch (verzikAttackStyle.getStyle()) {
          case AttackStyle.MELEE: {
            attackType = NpcAttack.TOB_VERZIK_P3_MELEE;
            if (npcAttack.hasTarget()) {
              const stats = this.getCurrentStageStats(npcAttack.getTarget()!);
              stats.tobVerzikP3Melees++;
            }
            break;
          }

          case AttackStyle.RANGE:
            attackType = NpcAttack.TOB_VERZIK_P3_RANGE;
            break;

          case AttackStyle.MAGE:
            attackType = NpcAttack.TOB_VERZIK_P3_MAGE;
            break;

          default:
            return false;
        }

        npcAttack.setAttack(attackType as Proto<NpcAttackMap>);

        // The VERZIK_ATTACK_STYLE event should not be written.
        return false;
      }
    }

    return true;
  }

  private async handlePlayerAttack(event: Event): Promise<void> {
    const username = event.getPlayer()?.getName();
    const attack = event.getPlayerAttack();

    if (username === undefined || attack === undefined) {
      return;
    }

    const target = attack.getTarget();
    const weapon = attack.getWeapon();

    const stats = this.getCurrentStageStats(username);

    switch (attack.getType()) {
      case PlayerAttack.GODSWORD_SMACK:
      case PlayerAttack.HAMMER_BOP:
      case PlayerAttack.CHALLY_SWIPE:
      case PlayerAttack.ELDER_MAUL:
      case PlayerAttack.TONALZTICS_AUTO: {
        if (this.getStage() === Stage.TOB_VERZIK) {
          if (target !== undefined && Npc.isVerzikMatomenos(target.getId())) {
            // Can 6t or 7t a red crab to tick fix; not a troll.
            return;
          }
        }

        if (attack.getType() !== PlayerAttack.TONALZTICS_AUTO) {
          const inCleanup =
            this.getSplit(SplitType.TOB_NYLO_WAVES) !== undefined &&
            this.getSplit(SplitType.TOB_NYLO_CLEANUP) === undefined;

          if (this.getStage() === Stage.TOB_NYLOCAS && inCleanup) {
            // Ok to overkill a nylo during cleanup.
            if (target === undefined || Npc.isNylocas(target.getId())) {
              return;
            }
          }
        }

        if (attack.getType() === PlayerAttack.GODSWORD_SMACK) {
          stats.bgsSmacks += 1;
        } else if (attack.getType() === PlayerAttack.HAMMER_BOP) {
          stats.hammerBops += 1;
        } else if (attack.getType() === PlayerAttack.CHALLY_SWIPE) {
          stats.challyPokes += 1;
        } else if (attack.getType() === PlayerAttack.ELDER_MAUL) {
          stats.elderMaulSmacks += 1;
        } else {
          stats.ralosAutos += 1;
        }
        break;
      }

      case PlayerAttack.CHIN_BLACK:
      case PlayerAttack.CHIN_GREY:
      case PlayerAttack.CHIN_RED: {
        let chinPrice = 0;
        if (weapon !== undefined) {
          try {
            chinPrice = await priceTracker.getPrice(weapon.getId());
          } catch (e) {
            chinPrice = 0;
          }
        }

        const isWrongThrowDistance =
          attack.getDistanceToTarget() !== -1 &&
          (attack.getDistanceToTarget() < 4 ||
            attack.getDistanceToTarget() > 6);

        stats.chinsThrownTotal += 1;
        stats.chinsThrownValue += chinPrice;

        if (event.getStage() === Stage.TOB_MAIDEN) {
          stats.chinsThrownMaiden += 1;
        } else if (event.getStage() === Stage.TOB_NYLOCAS) {
          stats.chinsThrownNylocas += 1;
        }

        if (attack.getType() === PlayerAttack.CHIN_BLACK) {
          stats.chinsThrownBlack += 1;
        } else if (attack.getType() === PlayerAttack.CHIN_RED) {
          stats.chinsThrownRed += 1;
        } else if (attack.getType() === PlayerAttack.CHIN_GREY) {
          stats.chinsThrownGrey += 1;
        }

        if (target !== undefined && isWrongThrowDistance) {
          // Only consider incorrect throw distances on Maiden crabs.
          if (Npc.isMaidenMatomenos(target.getId())) {
            stats.chinsThrownIncorrectlyMaiden += 1;
          }
        }
        break;
      }

      case PlayerAttack.CLAW_SPEC:
      case PlayerAttack.BGS_SPEC:
      case PlayerAttack.DINHS_SPEC:
      case PlayerAttack.CHALLY_SPEC:
      case PlayerAttack.HAMMER_SPEC:
      case PlayerAttack.VOIDWAKER_SPEC:
      case PlayerAttack.ELDER_MAUL_SPEC:
      case PlayerAttack.TONALZTICS_SPEC:
      case PlayerAttack.VOLATILE_NM_SPEC: {
        if (target !== undefined && Npc.isVerzikP1(target.getId())) {
          stats.tobVerzikP1TrollSpecs++;
        }
        break;
      }

      case PlayerAttack.SCYTHE_UNCHARGED:
        stats.unchargedScytheSwings += 1;
        break;

      case PlayerAttack.SANG_BARRAGE:
      case PlayerAttack.SHADOW_BARRAGE:
      case PlayerAttack.TOXIC_TRIDENT_BARRAGE:
      case PlayerAttack.TRIDENT_BARRAGE:
      case PlayerAttack.UNKNOWN_BARRAGE:
        stats.tobBarragesWithoutProperWeapon += 1;
        break;
    }
  }

  private handleSoteMazePath(soteMaze: Event.SoteMaze): void {
    const currentMaze = this.soteMazes[this.soteMazes.length - 1];

    const overworldPivots = soteMaze
      .getOverworldPivotsList()
      .map((pivot) => pivot.getX());
    if (overworldPivots.length === 8) {
      if (!currentMaze.accuratePath) {
        currentMaze.pivots = overworldPivots;
        currentMaze.accuratePath = true;
      } else {
        const pivotsEqual = currentMaze.pivots.every(
          (pivot, index) => pivot === overworldPivots[index],
        );
        if (!pivotsEqual) {
          console.error(
            `Raid ${this.getId()}: Overworld pivots do not match existing maze`,
          );
        }
      }
      return;
    }
    if (overworldPivots.length > 0) {
      console.error(
        `Raid ${this.getId()}: Received partial overworld pivots: ${overworldPivots}`,
      );
    }

    const underworldPivots = soteMaze.getUnderworldPivotsList();
    if (underworldPivots.length === 0 || currentMaze.accuratePath) {
      return;
    }

    if (underworldPivots.length === 8) {
      currentMaze.pivots = underworldPivots.map((pivot) => pivot.getX());
      currentMaze.accuratePath = true;
      return;
    }

    // Received a partial maze path from HMT.
    for (const pivot of underworldPivots) {
      if (pivot.getY() % 2 !== 0) {
        console.error(
          `Raid ${this.getId()}: Invalid pivot on row ${pivot.getY()}`,
        );
        continue;
      }

      const pivotIndex = pivot.getY() / 2;

      if (currentMaze.partialPivots[pivotIndex] === -1) {
        currentMaze.partialPivots[pivotIndex] = pivot.getX();
      } else {
        console.error(
          `Raid ${this.getId()}: Duplicate pivot on row ${pivot.getY()}`,
        );
        continue;
      }

      const mazeComplete = currentMaze.partialPivots.every((x) => x !== -1);
      if (mazeComplete) {
        currentMaze.pivots = currentMaze.partialPivots;
        currentMaze.accuratePath = true;
        break;
      }
    }

    console.log(
      `Raid ${this.getId()}: Partial maze progress: ${currentMaze.partialPivots}`,
    );
  }

  /**
   * Corrects any recorded splits and other stage information that were affected
   * by tick loss.
   *
   * @param tickOffset The number of ticks lost.
   */
  private correctRoomDataForTickOffset(tickOffset: number): void {
    // TODO(frolv): This function is disabled and should be removed.
    return;

    this.getStageNpcs().forEach((npc) => {
      npc.spawnTick += tickOffset;
      npc.deathTick += tickOffset;
    });

    const adjustSplitsForOffset = (split: SplitType[]) => {
      for (const type of split) {
        const value = this.getSplit(type);
        if (value !== undefined) {
          this.setSplit(type, value + tickOffset);
        }
      }
    };

    switch (this.getStage()) {
      case Stage.TOB_MAIDEN:
        adjustSplitsForOffset([
          SplitType.TOB_MAIDEN_70S,
          SplitType.TOB_MAIDEN_50S,
          SplitType.TOB_MAIDEN_30S,
        ]);
        break;

      case Stage.TOB_BLOAT:
        this.bloatDownTicks = this.bloatDownTicks.map(
          (tick) => tick + tickOffset,
        );
        break;

      case Stage.TOB_NYLOCAS:
        adjustSplitsForOffset([
          SplitType.TOB_NYLO_CAP,
          SplitType.TOB_NYLO_WAVES,
          SplitType.TOB_NYLO_CLEANUP,
          SplitType.TOB_NYLO_BOSS_SPAWN,
        ]);
        break;

      case Stage.TOB_SOTETSEG:
        adjustSplitsForOffset([
          SplitType.TOB_SOTETSEG_66,
          SplitType.TOB_SOTETSEG_33,
        ]);
        break;

      case Stage.TOB_XARPUS:
        adjustSplitsForOffset([
          SplitType.TOB_XARPUS_EXHUMES,
          SplitType.TOB_XARPUS_SCREECH,
        ]);
        break;

      case Stage.TOB_VERZIK:
        adjustSplitsForOffset([
          SplitType.TOB_VERZIK_P1_END,
          SplitType.TOB_VERZIK_REDS,
          SplitType.TOB_VERZIK_P2_END,
        ]);
        break;
    }
  }
}
