import {
  ChallengeMode,
  ChallengeStatus,
  ChallengeType,
  DataRepository,
  MaidenCrabSpawn,
  Maze,
  Npc,
  NpcAttack,
  NpcId,
  NyloStyle,
  PlayerAttack,
  PriceTracker,
  SkillLevel,
  SplitType,
  Stage,
  StageStatus,
  TobChallengeStats,
  TobRooms,
  VerzikAttackStyle,
  VerzikPhase,
  XarpusPhase,
  camelToSnakeObject,
} from '@blert/common';
import { Event, NpcAttackMap } from '@blert/common/generated/event_pb';

import ChallengeProcessor, { InitializedFields } from './challenge-processor';
import sql from '../db';
import logger from '../log';
import { MergedEvents } from '../merge';

type SoteMazeState = {
  pivots: number[];
  startTick: number;
  endTick: number;
  accuratePath: boolean;
  partialPivots: number[];
};

function roomsKey(stage: Stage): keyof TobRooms {
  switch (stage) {
    case Stage.TOB_MAIDEN:
      return 'maiden';
    case Stage.TOB_BLOAT:
      return 'bloat';
    case Stage.TOB_NYLOCAS:
      return 'nylocas';
    case Stage.TOB_SOTETSEG:
      return 'sotetseg';
    case Stage.TOB_XARPUS:
      return 'xarpus';
    case Stage.TOB_VERZIK:
      return 'verzik';
    default:
      throw new Error(`Invalid ToB stage: ${stage}`);
  }
}

function nyloBossStyle(npcId: number): NyloStyle {
  switch (npcId) {
    case NpcId.NYLOCAS_VASILIAS_MAGE_ENTRY:
    case NpcId.NYLOCAS_VASILIAS_MAGE_REGULAR:
    case NpcId.NYLOCAS_VASILIAS_MAGE_HARD:
      return NyloStyle.MAGE;

    case NpcId.NYLOCAS_VASILIAS_RANGE_ENTRY:
    case NpcId.NYLOCAS_VASILIAS_RANGE_REGULAR:
    case NpcId.NYLOCAS_VASILIAS_RANGE_HARD:
      return NyloStyle.RANGE;

    case NpcId.NYLOCAS_VASILIAS_MELEE_ENTRY:
    case NpcId.NYLOCAS_VASILIAS_MELEE_REGULAR:
    case NpcId.NYLOCAS_VASILIAS_MELEE_HARD:
      return NyloStyle.MELEE;
  }
  throw new Error(`Invalid Nylocas Vasilias ID: ${npcId}`);
}

export default class TheatreProcessor extends ChallengeProcessor {
  private rooms: TobRooms;

  private stageStats: Partial<TobChallengeStats>;
  private bloatDownTicks: number[];
  private stalledNyloWaves: number[];
  private nyloBossStyles: {
    prev: NyloStyle;
    mage: number;
    ranged: number;
    melee: number;
  };
  private soteMazes: SoteMazeState[];
  private verzikRedSpawns: number[];

  public constructor(
    dataRepository: DataRepository,
    priceTracker: PriceTracker,
    uuid: string,
    mode: ChallengeMode,
    stage: Stage,
    stageStatus: StageStatus,
    party: string[],
    extraFields: InitializedFields = {},
  ) {
    super(
      dataRepository,
      priceTracker,
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

    this.stageStats = {};
    this.bloatDownTicks = [];
    this.stalledNyloWaves = [];
    this.nyloBossStyles = {
      prev: NyloStyle.MELEE,
      mage: 0,
      ranged: 0,
      melee: 0,
    };
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

  protected override async onCreate(): Promise<void> {
    await Promise.all([
      sql`
        INSERT INTO tob_challenge_stats (challenge_id)
        VALUES (${this.getDatabaseId()})
      `,
      this.getDataRepository().saveTobChallengeData(this.getUuid(), this.rooms),
    ]);
  }

  protected override async onFinish(): Promise<void> {
    this.setSplit(SplitType.TOB_CHALLENGE, this.getTotalChallengeTicks());
    this.setSplit(SplitType.TOB_OVERALL, this.getOverallTicks());

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
        this.stageStats.maidenDeaths = this.rooms.maiden.deaths.length;
        break;

      case Stage.TOB_BLOAT:
        stageSplit = SplitType.TOB_BLOAT;
        this.rooms.bloat = {
          ...roomData,
          stage: Stage.TOB_BLOAT,
          downTicks: this.bloatDownTicks,
        };
        this.stageStats.bloatDeaths = this.rooms.bloat.deaths.length;
        break;

      case Stage.TOB_NYLOCAS: {
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

        this.stageStats.nylocasDeaths = this.rooms.nylocas.deaths.length;

        this.stageStats.nylocasStalls = new Array(31).fill(0);
        this.stageStats.nylocasPreCapStalls = 0;
        this.stageStats.nylocasPostCapStalls = 0;
        for (const wave of this.stalledNyloWaves) {
          if (wave < 20) {
            this.stageStats.nylocasPreCapStalls! += 1;
          } else {
            this.stageStats.nylocasPostCapStalls! += 1;
          }
          this.stageStats.nylocasStalls[wave - 1] += 1;
        }

        this.stageStats.nylocasBossMage = this.nyloBossStyles.mage;
        this.stageStats.nylocasBossRanged = this.nyloBossStyles.ranged;
        this.stageStats.nylocasBossMelee = this.nyloBossStyles.melee;
        break;
      }

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
        this.stageStats.sotetsegDeaths = this.rooms.sotetseg.deaths.length;
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
        this.stageStats.xarpusDeaths = this.rooms.xarpus.deaths.length;
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
        this.stageStats.verzikDeaths = this.rooms.verzik.deaths.length;
        break;
    }

    await this.updateChallengeStats(this.stageStats);
    this.stageStats = {};

    this.setSplit(stageSplit!, stageTicks);

    await this.getDataRepository().saveTobChallengeData(
      this.getUuid(),
      this.rooms,
    );
  }

  protected override async processChallengeEvent(
    allEvents: MergedEvents,
    event: Event,
  ): Promise<boolean> {
    switch (event.getType()) {
      case Event.Type.PLAYER_DEATH: {
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
      }

      case Event.Type.PLAYER_ATTACK:
        await this.processPlayerAttack(event);
        break;

      case Event.Type.NPC_SPAWN:
        this.processNpcSpawn(event, event.getNpc()!);
        break;

      case Event.Type.NPC_UPDATE: {
        const npc = event.getNpc()!;
        if (Npc.isNylocasVasilias(npc.getId())) {
          const style = nyloBossStyle(npc.getId());
          if (this.nyloBossStyles.prev !== style) {
            switch (style) {
              case NyloStyle.MAGE:
                this.nyloBossStyles.mage += 1;
                break;
              case NyloStyle.RANGE:
                this.nyloBossStyles.ranged += 1;
                break;
              case NyloStyle.MELEE:
                this.nyloBossStyles.melee += 1;
                break;
            }
          }
          this.nyloBossStyles.prev = style;
        }
        break;
      }

      case Event.Type.TOB_MAIDEN_CRAB_LEAK: {
        const npc = event.getNpc()!;
        const hitpoints = SkillLevel.fromRaw(npc.getHitpoints());
        if (
          npc.hasMaidenCrab() &&
          hitpoints.getCurrent() === hitpoints.getBase()
        ) {
          if (!this.stageStats.maidenFullLeaks) {
            this.stageStats.maidenFullLeaks = 1;
          } else {
            this.stageStats.maidenFullLeaks += 1;
          }
        }
        break;
      }

      case Event.Type.TOB_BLOAT_DOWN: {
        this.bloatDownTicks.push(event.getTick());

        if (event.getBloatDown()!.getDownNumber() === 1) {
          const bloat = allEvents
            .eventsForTick(event.getTick())
            .find(
              (e) =>
                e.getType() === Event.Type.NPC_UPDATE &&
                Npc.isBloat(e.getNpc()!.getId()),
            );
          if (bloat) {
            const hitpoints = SkillLevel.fromRaw(
              bloat.getNpc()!.getHitpoints(),
            );
            this.stageStats.bloatFirstDownHpPercent = hitpoints.percentage();
          }
        }
        break;
      }

      case Event.Type.TOB_NYLO_WAVE_SPAWN:
        const spawnedWave = event.getNyloWave()!.getWave();
        if (spawnedWave === 20) {
          this.setSplit(SplitType.TOB_NYLO_CAP, event.getTick());
        } else if (spawnedWave === 31) {
          this.setSplit(SplitType.TOB_NYLO_WAVES, event.getTick());
        }
        break;

      case Event.Type.TOB_NYLO_WAVE_STALL:
        const stalledWave = event.getNyloWave()!.getWave();
        this.stalledNyloWaves.push(stalledWave);
        break;

      case Event.Type.TOB_NYLO_CLEANUP_END:
        this.setSplit(SplitType.TOB_NYLO_CLEANUP, event.getTick());
        break;

      case Event.Type.TOB_NYLO_BOSS_SPAWN:
        this.setSplit(SplitType.TOB_NYLO_BOSS_SPAWN, event.getTick());
        break;

      case Event.Type.TOB_SOTE_MAZE_PROC: {
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

      case Event.Type.TOB_SOTE_MAZE_PATH: {
        const soteMaze = event.getSoteMaze()!;
        if (soteMaze.getOverworldTilesList().length > 0) {
          return true;
        }

        // Update the maze path and don't write the event.
        this.handleSoteMazePath(soteMaze);
        return false;
      }

      case Event.Type.TOB_SOTE_MAZE_END: {
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

      case Event.Type.TOB_XARPUS_PHASE:
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

      case Event.Type.TOB_VERZIK_PHASE:
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

      case Event.Type.TOB_VERZIK_ATTACK_STYLE: {
        // Update the previously-written NPC_ATTACK event.
        const verzikAttackStyle = event.getVerzikAttackStyle()!;

        const attackEvent = allEvents
          .eventsForTick(verzikAttackStyle.getNpcAttackTick())
          .find(
            (e) =>
              e.getType() === Event.Type.NPC_ATTACK &&
              e.getNpcAttack()!.getAttack() === NpcAttack.TOB_VERZIK_P3_AUTO,
          );

        if (attackEvent === undefined) {
          logger.warn(
            `Challenge ${this.getUuid()} got VERZIK_ATTACK_STYLE without a matching NPC_ATTACK`,
          );
          return false;
        }

        const npcAttack = attackEvent.getNpcAttack()!;

        let attackType: NpcAttack;
        switch (verzikAttackStyle.getStyle()) {
          case VerzikAttackStyle.MELEE: {
            attackType = NpcAttack.TOB_VERZIK_P3_MELEE;
            if (npcAttack.hasTarget()) {
              const stats = this.getCurrentStageStats(npcAttack.getTarget()!);
              stats.tobVerzikP3Melees++;
            }
            break;
          }

          case VerzikAttackStyle.RANGE:
            attackType = NpcAttack.TOB_VERZIK_P3_RANGE;
            break;

          case VerzikAttackStyle.MAGE:
            attackType = NpcAttack.TOB_VERZIK_P3_MAGE;
            break;

          default:
            return false;
        }

        npcAttack.setAttack(attackType as NpcAttackMap[keyof NpcAttackMap]);

        // The VERZIK_ATTACK_STYLE event should not be written.
        return false;
      }
    }

    return true;
  }

  protected override getCustomData(): object | null {
    return this.rooms;
  }

  protected override hasFullyRecordedUpTo(stage: Stage): boolean {
    if (stage < Stage.TOB_MAIDEN || stage > Stage.TOB_VERZIK) {
      return false;
    }

    for (let s = Stage.TOB_MAIDEN; s <= stage; s++) {
      if (this.rooms[roomsKey(s)] === null) {
        return false;
      }
    }

    return true;
  }

  private async processPlayerAttack(event: Event): Promise<void> {
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
            chinPrice = await this.getPriceTracker().getPrice(weapon.getId());
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

  private processNpcSpawn(event: Event, npc: Event.Npc): void {
    if (Npc.isVerzikMatomenos(npc.getId())) {
      if (this.verzikRedSpawns.length === 0) {
        // First red spawn is recorded as a stage split.
        this.setSplit(SplitType.TOB_VERZIK_REDS, event.getTick());
        this.verzikRedSpawns.push(event.getTick());
        this.stageStats.verzikRedsCount = 1;
      } else if (
        this.verzikRedSpawns[this.verzikRedSpawns.length - 1] !==
        event.getTick()
      ) {
        // A new spawn occurred.
        this.verzikRedSpawns.push(event.getTick());
        this.stageStats.verzikRedsCount! += 1;
      }
    }

    if (npc.hasMaidenCrab()) {
      // Record Maiden spawns as stage splits.
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

      if (npc.getMaidenCrab()!.getScuffed()) {
        this.stageStats.maidenScuffedSpawns = true;
      }
    }

    if (npc.hasNylo()) {
      const nylo = npc.getNylo()!;
      if (nylo.getSpawnType() === Event.Npc.Nylo.SpawnType.SPLIT) {
        switch (nylo.getStyle()) {
          case Event.Npc.Nylo.Style.MAGE:
            if (!this.stageStats.nylocasMageSplits) {
              this.stageStats.nylocasMageSplits = 1;
            } else {
              this.stageStats.nylocasMageSplits += 1;
            }
            break;
          case Event.Npc.Nylo.Style.RANGE:
            if (!this.stageStats.nylocasRangedSplits) {
              this.stageStats.nylocasRangedSplits = 1;
            } else {
              this.stageStats.nylocasRangedSplits += 1;
            }
            break;
          case Event.Npc.Nylo.Style.MELEE:
            if (!this.stageStats.nylocasMeleeSplits) {
              this.stageStats.nylocasMeleeSplits = 1;
            } else {
              this.stageStats.nylocasMeleeSplits += 1;
            }
            break;
        }
      }
    }

    if (Npc.isNylocasVasiliasDropping(npc.getId())) {
      this.nyloBossStyles.prev = NyloStyle.MELEE;
      this.nyloBossStyles.melee = 1;
    } else if (Npc.isNylocasVasilias(npc.getId())) {
      // If the client lagged and missed the dropping NPC spawn, use the
      // current style of the boss as its initial style.
      const style = nyloBossStyle(npc.getId());
      this.nyloBossStyles.prev = style;
      switch (style) {
        case NyloStyle.MAGE:
          this.nyloBossStyles.mage = 1;
          break;
        case NyloStyle.RANGE:
          this.nyloBossStyles.ranged = 1;
          break;
        case NyloStyle.MELEE:
          this.nyloBossStyles.melee = 1;
          break;
      }
    }
  }

  private handleSoteMazePath(soteMaze: Event.SoteMaze): void {
    const currentMaze = this.soteMazes[this.soteMazes.length - 1];
    if (currentMaze.accuratePath) {
      return;
    }

    const underworldPivots = soteMaze.getUnderworldPivotsList();
    if (underworldPivots.length === 8) {
      currentMaze.pivots = underworldPivots.map((pivot) => pivot.getX());
      currentMaze.accuratePath = true;
      return;
    }

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
          logger.error(
            `Challenge ${this.getUuid()}: Overworld pivots do not match existing maze`,
          );
        }
      }
      return;
    }
    if (overworldPivots.length > 0) {
      logger.error(
        `Challenge ${this.getUuid()}: Received partial overworld pivots: ${overworldPivots}`,
      );
    }

    // Received a partial maze path from HMT.
    for (const pivot of underworldPivots) {
      if (pivot.getY() % 2 !== 0) {
        logger.error(
          `Challenge ${this.getUuid()}: Invalid pivot on row ${pivot.getY()}`,
        );
        continue;
      }

      const pivotIndex = pivot.getY() / 2;

      if (currentMaze.partialPivots[pivotIndex] === -1) {
        currentMaze.partialPivots[pivotIndex] = pivot.getX();
      } else {
        logger.warn(
          `Challenge ${this.getUuid()}: Duplicate pivot on row ${pivot.getY()}`,
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

    logger.debug(
      `Challenge ${this.getUuid()}: Partial maze progress: ${currentMaze.partialPivots}`,
    );
  }

  private async updateChallengeStats(
    updates: Partial<TobChallengeStats>,
  ): Promise<void> {
    await sql`
      UPDATE tob_challenge_stats
      SET ${sql(camelToSnakeObject(updates))}
      WHERE challenge_id = ${this.getDatabaseId()};
    `;
  }
}
