import {
  BloatSplits,
  ChallengeMode,
  ChallengeStatus,
  EventType,
  MaidenCrab,
  MaidenCrabSpawn,
  MaidenSplits,
  Maze,
  Npc,
  NpcAttack,
  Nylo,
  NyloSplits,
  PersonalBestType,
  PlayerAttack,
  PlayerInfo,
  PrimaryMeleeGear,
  RecordedChallengeModel,
  RecordingType,
  RoomNpc,
  RoomNpcType,
  SoteSplits,
  Stage,
  StageStatus,
  VerzikAttackStyle,
  VerzikCrab,
  VerzikPhase,
  VerzikSplits,
  XarpusPhase,
  XarpusSplits,
  tobPbForMode,
} from '@blert/common';
import { RaidModel, RoomEvent } from '@blert/common';
import { Event } from '@blert/common/generated/event_pb';

import Client from './client';
import { Players } from './players';
import { priceTracker } from './price-tracker';
import { protoToEvent } from './proto';

export function raidPartyKey(partyMembers: string[]) {
  return partyMembers
    .map((name) => name.toLowerCase().replace(' ', '_'))
    .join('-');
}

enum State {
  STARTING,
  IN_PROGRESS,
  ENDING,
}

const BLORVA_PLATEBODY_ID = 28256;
const TORVA_PLATEBODY_ID = 26384;
const BANDOS_CHESTPLATE_ID = 11832;
const VOID_MELEE_HELM_ID = 11665;
const VOID_MELEE_HELM_OR_ID = 26477;

type PersonalBestUpdate = {
  pbType: PersonalBestType;
  pbTime: number;
};

export default class Raid {
  private id: string;
  private partyKey: string;
  private clients: Client[];

  private state: State;
  private mode: ChallengeMode;
  private party: string[];
  private partyInfo: PlayerInfo[];
  private startTime: number;
  private challengeStatus: ChallengeStatus;
  private completedRooms: number;
  private totalTicks: number;
  private overallTicks: number;

  private playerInfoUpdated: Set<string>;

  private stage: Stage;
  private stageStatus: StageStatus;
  private stageTick: number;
  private stageEvents: Event[];
  private deathsInRoom: string[];
  private queuedPbUpdates: PersonalBestUpdate[];

  private maidenSplits: MaidenSplits;
  private bloatSplits: BloatSplits;
  private nyloSplits: NyloSplits;
  private soteSplits: SoteSplits;
  private xarpusSplits: XarpusSplits;
  private verzikSplits: VerzikSplits;

  private npcs: Map<String, RoomNpc>;
  private stalledNyloWaves: number[];
  private verzikRedSpawns: number[];

  public constructor(
    id: string,
    party: string[],
    mode: ChallengeMode,
    startTime: number,
  ) {
    this.id = id;
    this.partyKey = raidPartyKey(party);
    this.clients = [];

    this.state = State.STARTING;
    this.mode = mode;
    this.party = party;
    this.partyInfo = this.party.map((_) => ({ gear: PrimaryMeleeGear.BLORVA }));
    this.startTime = startTime;
    this.challengeStatus = ChallengeStatus.IN_PROGRESS;
    this.completedRooms = 0;
    this.totalTicks = 0;
    this.overallTicks = 0;

    this.playerInfoUpdated = new Set();

    this.stage = Stage.TOB_MAIDEN;
    this.stageStatus = StageStatus.ENTERED;
    this.stageTick = 0;
    this.stageEvents = [];
    this.deathsInRoom = [];
    this.queuedPbUpdates = [];

    this.maidenSplits = {
      SEVENTIES: 0,
      FIFTIES: 0,
      THIRTIES: 0,
    };
    this.bloatSplits = { downTicks: [] };
    this.nyloSplits = { capIncrease: 0, waves: 0, cleanup: 0, boss: 0 };
    this.soteSplits = { MAZE_66: 0, MAZE_33: 0 };
    this.xarpusSplits = { exhumes: 0, screech: 0 };
    this.verzikSplits = { p1: 0, reds: 0, p2: 0 };

    this.npcs = new Map();
    this.stalledNyloWaves = [];
    this.verzikRedSpawns = [];
  }

  public getId(): string {
    return this.id;
  }

  public getPartyKey(): string {
    return this.partyKey;
  }

  public getScale(): number {
    return this.party.length;
  }

  public getStartTime(): number {
    return this.startTime;
  }

  public setOverallTime(time: number): void {
    this.overallTicks = time;
  }

  public async setMode(mode: ChallengeMode): Promise<void> {
    if (this.mode === mode) {
      return;
    }
    this.mode = mode;
    await this.updateDatabaseFields((record) => {
      record.mode = this.mode;
    });
  }

  public hasClients(): boolean {
    return this.clients.length > 0;
  }

  public async initialize(): Promise<void> {
    const record = new RaidModel({
      _id: this.id,
      mode: this.mode,
      stage: this.stage,
      status: this.challengeStatus,
      party: this.party,
      partyInfo: this.partyInfo,
      startTime: this.startTime,
      totalTicks: 0,
    });
    await record.save();
  }

  public async finish(): Promise<void> {
    if (this.state === State.STARTING) {
      console.log(`Raid ${this.id} ended before Maiden; deleting record`);
      await Promise.all([
        RaidModel.deleteOne({ _id: this.id }),
        RecordedChallengeModel.deleteMany({ cId: this.id }),
      ]);
      return;
    }

    let promises: Promise<void>[] = [];

    promises.push(
      this.updateDatabaseFields((record) => {
        record.status = this.challengeStatus;
      }),
    );

    if (
      this.challengeStatus === ChallengeStatus.COMPLETED &&
      this.completedRooms === 6
    ) {
      promises.push(
        this.updatePartyPbs(PersonalBestType.TOB_CHALLENGE, this.totalTicks),
      );

      if (this.overallTicks !== 0) {
        promises.push(
          this.updatePartyPbs(PersonalBestType.TOB_OVERALL, this.overallTicks),
        );
      }
    }

    for (const username of this.party) {
      promises.push(
        Players.updateStats(username, (stats) => {
          switch (this.challengeStatus) {
            case ChallengeStatus.COMPLETED:
              stats.completions += 1;
              break;
            case ChallengeStatus.RESET:
              stats.resets += 1;
              break;
            case ChallengeStatus.WIPED:
              stats.wipes += 1;
              break;
          }
        }),
      );
    }

    await Promise.all(promises);
  }

  public async processEvent(event: Event): Promise<void> {
    switch (event.getType()) {
      case Event.Type.STAGE_UPDATE:
        await this.handleStageUpdate(event);
        break;

      default:
        if (event.getStage() !== this.stage) {
          console.error(
            `Raid ${this.id} got event ${event.getType()} for stage ` +
              `${event.getStage()} but is at stage ${this.stage}`,
          );
          return;
        }

        const writeToDb = await this.updateRaidStatus(event);

        // Batch and flush events once per tick to reduce database writes.
        if (event.getTick() === this.stageTick) {
          if (writeToDb) {
            this.stageEvents.push(event);
          }
        } else if (event.getTick() > this.stageTick) {
          await this.flushRoomEvents();
          if (writeToDb) {
            this.stageEvents.push(event);
          }
          this.stageTick = event.getTick();
        } else {
          console.error(
            `Raid ${this.id} got event ${event.getType()} for tick ${event.getTick()} (current=${this.stageTick})`,
          );
        }
        break;
    }
  }

  /**
   * Adds a new client as an event source for the raid.
   * @param client The client.
   * @param spectator Whether the client is spectating the raid.
   * @returns `true` if the client was added, `false` if not.
   */
  public async registerClient(
    client: Client,
    spectator: boolean,
  ): Promise<boolean> {
    if (client.getActiveRaid() !== null) {
      console.error(
        `Client ${client.getSessionId()} attempted to join raid ${this.id}, but is already in a raid`,
      );
      return false;
    }

    if (this.clients.find((c) => c == client) !== undefined) {
      return false;
    }

    this.clients.push(client);
    client.setActiveRaid(this);

    const recordedRaid = new RecordedChallengeModel({
      recorderId: client.getUserId(),
      cId: this.id,
      recordingType: spectator ? RecordingType.SPECTATOR : RecordingType.RAIDER,
    });
    await recordedRaid.save();

    return true;
  }

  /**
   * Removes a client from being an event source for the raid.
   * @param client The client.
   */
  public removeClient(client: Client): void {
    if (client.getActiveRaid() == this) {
      this.clients = this.clients.filter((c) => c != client);
      client.setActiveRaid(null);
    } else {
      console.error(
        `Client ${client.getSessionId()} tried to leave raid ${this.id}, but was not in it`,
      );
    }
  }

  private async start(): Promise<void> {
    this.state = State.IN_PROGRESS;
    const promises = this.party.map(Players.startNewRaid);
    await Promise.all(promises);
  }

  private async handleStageUpdate(event: Event): Promise<void> {
    const stageUpdate = event.getStageUpdate();
    if (event.getStage() === Stage.UNKNOWN || stageUpdate === undefined) {
      return;
    }

    switch (stageUpdate.getStatus()) {
      case StageStatus.STARTED:
        if (this.state === State.STARTING) {
          await this.start();
        }
        await this.updateDatabaseFields((record) => {
          record.stage = this.stage;
        });
        if (this.stageStatus === StageStatus.ENTERED) {
          // A transition from ENTERED -> STARTED has already reset the stage.
          // Don't clear any data received afterwards, unless the stage is new.
          if (this.stage === event.getStage()) {
            break;
          }
        }
      // A transition from any other state to STARTED should fall through
      // and reset all stage data.
      case StageStatus.ENTERED:
        this.stage = event.getStage();
        this.stageEvents = [];
        this.stageTick = 0;
        this.deathsInRoom = [];
        this.queuedPbUpdates = [];
        this.npcs.clear();
        break;

      case StageStatus.WIPED:
      case StageStatus.COMPLETED:
        if (event.getStage() === this.stage) {
          this.handleStageFinished(event, stageUpdate);
        } else {
          console.error(
            `Raid ${this.id} got status ${stageUpdate.getStatus()} for stage ` +
              `${event.getStage()} but is at stage ${this.stage}`,
          );
        }
        break;
    }

    this.stageStatus = stageUpdate.getStatus();
  }

  private async handleStageFinished(
    event: Event,
    stageUpdate: Event.StageUpdate,
  ): Promise<void> {
    // Set the appropriate status if the raid were to be finished at this
    // point.
    if (stageUpdate.getStatus() === StageStatus.WIPED) {
      this.challengeStatus = ChallengeStatus.WIPED;
    } else if (this.stage === Stage.TOB_VERZIK) {
      this.challengeStatus = ChallengeStatus.COMPLETED;
    } else {
      this.challengeStatus = ChallengeStatus.RESET;
    }

    this.completedRooms++;
    this.totalTicks += event.getTick();

    const promises = [];

    let firstTick = 0;
    if (!stageUpdate.getAccurate()) {
      const missingTicks = event.getTick() - this.stageTick;
      console.log(
        `Raid ${this.id} lost ${missingTicks} ticks at stage ${event.getStage()}`,
      );
      firstTick = missingTicks;

      this.correctRoomDataForTickOffset(missingTicks);

      promises.push(
        RoomEvent.updateMany(
          {
            cId: this.id,
            stage: event.getStage(),
          },
          { $inc: { tick: missingTicks } },
        ),
      );
      promises.push(
        RoomEvent.updateMany(
          {
            cId: this.id,
            stage: event.getStage(),
            type: EventType.PLAYER_UPDATE,
          },
          { $inc: { 'player.offCooldownTick': missingTicks } },
        ),
      );
    }

    promises.push(
      this.updateDatabaseFields((record) => {
        record.partyInfo = this.partyInfo;
        record.totalTicks += event.getTick();
        record.totalDeaths += this.deathsInRoom.length;

        let roomKey = 'maiden';
        switch (event.getStage()) {
          case Stage.TOB_MAIDEN:
            roomKey = 'maiden';
            break;
          case Stage.TOB_BLOAT:
            roomKey = 'bloat';
            break;
          case Stage.TOB_NYLOCAS:
            roomKey = 'nylocas';
            break;
          case Stage.TOB_SOTETSEG:
            roomKey = 'sotetseg';
            break;
          case Stage.TOB_XARPUS:
            roomKey = 'xarpus';
            break;
          case Stage.TOB_VERZIK:
            roomKey = 'verzik';
            break;
        }

        record.rooms[roomKey] = {
          firstTick,
          roomTicks: event.getTick(),
          deaths: this.deathsInRoom,
          npcs: this.npcs,
        };

        switch (this.stage) {
          case Stage.TOB_MAIDEN:
            record.rooms.maiden.splits = this.maidenSplits;
            break;
          case Stage.TOB_BLOAT:
            record.rooms.bloat.splits = this.bloatSplits;
            break;
          case Stage.TOB_NYLOCAS:
            record.rooms.nylocas.splits = this.nyloSplits;
            record.rooms.nylocas.stalledWaves = this.stalledNyloWaves;
            break;
          case Stage.TOB_SOTETSEG:
            record.rooms.sotetseg.splits = this.soteSplits;
            break;
          case Stage.TOB_XARPUS:
            record.rooms.xarpus.splits = this.xarpusSplits;
            break;
          case Stage.TOB_VERZIK:
            record.rooms.verzik.splits = this.verzikSplits;
            record.rooms.verzik.redCrabSpawns = this.verzikRedSpawns.length;
            break;
        }
      }),
      this.flushRoomEvents(),
    );

    if (stageUpdate.getAccurate()) {
      // Only update personal bests if the stage timer is accurate.
      this.queuedPbUpdates.forEach((update) => {
        promises.push(this.updatePartyPbs(update.pbType, update.pbTime));
      });

      if (stageUpdate.getStatus() === StageStatus.COMPLETED) {
        let pbType;
        switch (this.stage) {
          case Stage.TOB_MAIDEN:
            pbType = PersonalBestType.TOB_MAIDEN;
            break;
          case Stage.TOB_BLOAT:
            pbType = PersonalBestType.TOB_BLOAT;
            break;
          case Stage.TOB_NYLOCAS:
            pbType = PersonalBestType.TOB_NYLO_ROOM;
            promises.push(
              this.updatePartyPbs(
                PersonalBestType.TOB_NYLO_BOSS,
                event.getTick() - this.nyloSplits.boss,
              ),
            );
            break;
          case Stage.TOB_SOTETSEG:
            pbType = PersonalBestType.TOB_SOTETSEG;
            break;
          case Stage.TOB_XARPUS:
            pbType = PersonalBestType.TOB_XARPUS;
            break;
          case Stage.TOB_VERZIK:
            pbType = PersonalBestType.TOB_VERZIK_ROOM;
            promises.push(
              this.updatePartyPbs(
                PersonalBestType.TOB_VERZIK_P3,
                event.getTick() - (this.verzikSplits.p2 + 6),
              ),
            );
            break;
        }

        promises.push(this.updatePartyPbs(pbType!, event.getTick()));
      }
    }

    await Promise.all(promises);
  }

  /**
   * Updates the state of the raid from a received event.
   *
   * @param event The event that occurred.
   * @returns true if the event should be written to the database, false if not.
   */
  private async updateRaidStatus(event: Event): Promise<boolean> {
    switch (event.getType()) {
      case Event.Type.PLAYER_UPDATE:
        const updatedPlayer = event.getPlayer()!;
        if (!this.playerInfoUpdated.has(updatedPlayer.getName())) {
          this.tryDetermineGear(updatedPlayer);
        }
        return true;

      case Event.Type.PLAYER_DEATH:
        const deadPlayer = event.getPlayer()!;
        this.deathsInRoom.push(deadPlayer.getName());
        Players.updateStats(deadPlayer.getName(), (stats) => {
          stats.deaths += 1;

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
        });
        break;

      case EventType.PLAYER_ATTACK:
        await this.handlePlayerAttack(event);
        break;

      case EventType.NPC_SPAWN:
        await this.handleNpcSpawn(event);
        break;

      case EventType.NPC_DEATH:
        let npc = this.npcs.get(event.getNpc()!.getRoomId().toString());
        if (npc !== undefined) {
          npc.deathTick = event.getTick();
          npc.deathPoint = { x: event.getXCoord(), y: event.getYCoord() };
        }
        break;

      case EventType.TOB_BLOAT_DOWN:
        this.bloatSplits.downTicks.push(event.getTick());
        break;

      case EventType.TOB_NYLO_WAVE_SPAWN:
        const spawnedWave = event.getNyloWave()!.getWave();
        if (spawnedWave === 20) {
          this.nyloSplits.capIncrease = event.getTick();
        } else if (spawnedWave === 31) {
          this.nyloSplits.waves = event.getTick();
        }
        break;

      case EventType.TOB_NYLO_WAVE_STALL:
        const stalledWave = event.getNyloWave()!.getWave();
        this.stalledNyloWaves.push(stalledWave);
        break;

      case EventType.TOB_NYLO_CLEANUP_END:
        this.nyloSplits.cleanup = event.getTick();
        break;

      case EventType.TOB_NYLO_BOSS_SPAWN:
        this.nyloSplits.boss = event.getTick();
        this.queuedPbUpdates.push({
          pbType: PersonalBestType.TOB_NYLO_WAVES,
          pbTime: event.getTick(),
        });
        break;

      case EventType.TOB_SOTE_MAZE_PROC:
        const maze = event.getSoteMaze()!.getMaze();
        if (maze === Maze.MAZE_66) {
          this.soteSplits.MAZE_66 = event.getTick();
        } else {
          this.soteSplits.MAZE_33 = event.getTick();
        }
        break;

      case EventType.TOB_XARPUS_PHASE:
        const xarpusPhase = event.getXarpusPhase();
        if (xarpusPhase === XarpusPhase.P2) {
          this.xarpusSplits.exhumes = event.getTick();
        } else if (xarpusPhase === XarpusPhase.P3) {
          this.xarpusSplits.screech = event.getTick();
        }
        break;

      case EventType.TOB_VERZIK_PHASE:
        const verzikPhase = event.getVerzikPhase();
        if (verzikPhase === VerzikPhase.P2) {
          this.verzikSplits.p1 = event.getTick();
          this.queuedPbUpdates.push({
            pbType: PersonalBestType.TOB_VERZIK_P1,
            pbTime: event.getTick(),
          });
        } else if (verzikPhase === VerzikPhase.P3) {
          this.verzikSplits.p2 = event.getTick();
          if (this.verzikSplits.p1 !== 0) {
            this.queuedPbUpdates.push({
              pbType: PersonalBestType.TOB_VERZIK_P2,
              pbTime: event.getTick() - (this.verzikSplits.p1 + 13),
            });
          }
        }
        break;

      case EventType.TOB_VERZIK_ATTACK_STYLE:
        // Update the previously-written NPC_ATTACK event.
        const verzikAttackStyle = event.getVerzikAttackStyle()!;

        const record = await RoomEvent.findOne({
          cId: this.id,
          type: EventType.NPC_ATTACK,
          tick: verzikAttackStyle.getNpcAttackTick(),
          stage: Stage.TOB_VERZIK,
          'npcAttack.attack': NpcAttack.TOB_VERZIK_P3_AUTO,
        });

        if (record !== null) {
          switch (verzikAttackStyle.getStyle()) {
            case VerzikAttackStyle.MELEE:
              record.npcAttack.attack = NpcAttack.TOB_VERZIK_P3_MELEE;
              break;
            case VerzikAttackStyle.RANGE:
              record.npcAttack.attack = NpcAttack.TOB_VERZIK_P3_RANGE;
              break;
            case VerzikAttackStyle.MAGE:
              record.npcAttack.attack = NpcAttack.TOB_VERZIK_P3_MAGE;
              break;
          }
          record.save();
        }

        // The VERZIK_ATTACK_STYLE event should not be written.
        return false;
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

    switch (attack.getType()) {
      case PlayerAttack.BGS_SMACK:
      case PlayerAttack.HAMMER_BOP:
        if (this.stage === Stage.TOB_VERZIK) {
          if (target !== undefined && Npc.isVerzikMatomenos(target.getId())) {
            // Can 6t a red crab to tick fix; not a troll.
            return;
          }
        }

        if (
          this.stage === Stage.TOB_NYLOCAS &&
          this.nyloSplits.waves !== 0 &&
          this.nyloSplits.cleanup === 0
        ) {
          // Ok to BGS smack during cleanup.
          if (target === undefined || Npc.isNylocas(target.getId())) {
            return;
          }
        }

        await Players.updateStats(username, (stats) => {
          if (attack.getType() === PlayerAttack.BGS_SMACK) {
            stats.bgsSmacks += 1;
          } else {
            stats.hammerBops += 1;
          }
        });
        break;

      case PlayerAttack.CHIN_BLACK:
      case PlayerAttack.CHIN_GREY:
      case PlayerAttack.CHIN_RED:
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

        await Players.updateStats(username, (stats) => {
          stats.chinsThrown += 1;
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
        });
        break;

      case PlayerAttack.SCYTHE_UNCHARGED:
        await Players.updateStats(username, (stats) => {
          stats.unchargedScytheSwings += 1;
        });
        break;

      case PlayerAttack.SANG_BARRAGE:
      case PlayerAttack.SHADOW_BARRAGE:
      case PlayerAttack.TOXIC_TRIDENT_BARRAGE:
      case PlayerAttack.TRIDENT_BARRAGE:
      case PlayerAttack.UNKNOWN_BARRAGE:
        await Players.updateStats(username, (stats) => {
          stats.barragesWithoutProperWeapon += 1;
        });
        break;
    }
  }

  /**
   * Creates a `RoomNpc` entry in the NPC map for a newly-spawned NPC.
   *
   * @param event The spawn event.
   */
  private async handleNpcSpawn(event: Event): Promise<void> {
    const npc = event.getNpc();
    if (npc === undefined) {
      return;
    }

    let type = RoomNpcType.BASIC;
    if (npc.hasMaidenCrab()) {
      type = RoomNpcType.MAIDEN_CRAB;
    } else if (npc.hasNylo()) {
      type = RoomNpcType.NYLO;
    } else if (npc.hasVerzikCrab()) {
      type = RoomNpcType.VERZIK_CRAB;
    }

    const npcCommon = {
      type,
      spawnNpcId: npc.getId(),
      roomId: npc.getRoomId(),
      spawnTick: event.getTick(),
      spawnPoint: { x: event.getXCoord(), y: event.getYCoord() },
      deathTick: 0,
      deathPoint: { x: 0, y: 0 },
    };

    if (Npc.isVerzikMatomenos(npc.getId())) {
      if (this.verzikRedSpawns.length === 0) {
        // First red spawn is recorded as a stage split.
        this.verzikSplits.reds = event.getTick();
        this.verzikRedSpawns.push(event.getTick());
      } else if (
        this.verzikRedSpawns[this.verzikRedSpawns.length - 1] !==
        event.getTick()
      ) {
        // A new spawn occurred.
        this.verzikRedSpawns.push(event.getTick());
      }
    }

    const { maidenCrab, nylo, verzikCrab } = npc.toObject();

    if (maidenCrab !== undefined) {
      switch (maidenCrab.spawn) {
        case MaidenCrabSpawn.SEVENTIES:
          this.maidenSplits.SEVENTIES = event.getTick();
          break;
        case MaidenCrabSpawn.FIFTIES:
          this.maidenSplits.FIFTIES = event.getTick();
          break;
        case MaidenCrabSpawn.THIRTIES:
          this.maidenSplits.THIRTIES = event.getTick();
          break;
      }
      const crab: MaidenCrab = {
        ...npcCommon,
        type: RoomNpcType.MAIDEN_CRAB,
        maidenCrab,
      };
      this.npcs.set(npc.getRoomId().toString(), crab);
    } else if (nylo !== undefined) {
      const nyloDesc: Nylo = {
        ...npcCommon,
        type: RoomNpcType.NYLO,
        nylo,
      };
      this.npcs.set(npc.getRoomId().toString(), nyloDesc);
    } else if (verzikCrab !== undefined) {
      const crab: VerzikCrab = {
        ...npcCommon,
        type: RoomNpcType.VERZIK_CRAB,
        verzikCrab,
      };
      this.npcs.set(npc.getRoomId().toString(), crab);
    } else {
      this.npcs.set(npc.getRoomId().toString(), npcCommon);
    }
  }

  private async tryDetermineGear(player: Event.Player): Promise<void> {
    const equipment = player.getEquipmentList();
    if (equipment.length === 0) {
      return;
    }

    const torso = equipment.find(
      (item) => item.getSlot() === Event.Player.EquipmentSlot.TORSO,
    );
    const helm = equipment.find(
      (item) => item.getSlot() === Event.Player.EquipmentSlot.HEAD,
    );
    let gear: PrimaryMeleeGear | null = null;

    if (torso !== undefined) {
      switch (torso.getId()) {
        case BLORVA_PLATEBODY_ID:
          gear = PrimaryMeleeGear.BLORVA;
          break;
        case TORVA_PLATEBODY_ID:
          gear = PrimaryMeleeGear.TORVA;
          break;
        case BANDOS_CHESTPLATE_ID:
          gear = PrimaryMeleeGear.BANDOS;
          break;
      }
    }
    if (
      helm !== undefined &&
      (helm.getId() === VOID_MELEE_HELM_ID ||
        helm.getId() === VOID_MELEE_HELM_OR_ID)
    ) {
      gear = PrimaryMeleeGear.ELITE_VOID;
    }

    if (gear !== null) {
      this.playerInfoUpdated.add(player.getName());
      this.partyInfo[this.party.indexOf(player.getName())].gear = gear;
    }
  }

  /**
   * Corrects any recorded splits and other stage information that were affected
   * by tick loss.
   *
   * @param tickOffset The number of ticks lost.
   */
  private correctRoomDataForTickOffset(tickOffset: number): void {
    this.npcs.forEach((npc) => {
      npc.spawnTick += tickOffset;
      npc.deathTick += tickOffset;
    });

    switch (this.stage) {
      case Stage.TOB_MAIDEN:
        if (this.maidenSplits.SEVENTIES !== 0) {
          this.maidenSplits.SEVENTIES += tickOffset;
        }
        if (this.maidenSplits.FIFTIES !== 0) {
          this.maidenSplits.FIFTIES += tickOffset;
        }
        if (this.maidenSplits.THIRTIES !== 0) {
          this.maidenSplits.THIRTIES += tickOffset;
        }
        break;

      case Stage.TOB_BLOAT:
        this.bloatSplits.downTicks = this.bloatSplits.downTicks.map(
          (tick) => tick + tickOffset,
        );
        break;

      case Stage.TOB_NYLOCAS:
        if (this.nyloSplits.capIncrease !== 0) {
          this.nyloSplits.capIncrease += tickOffset;
        }
        if (this.nyloSplits.waves !== 0) {
          this.nyloSplits.waves += tickOffset;
        }
        if (this.nyloSplits.cleanup !== 0) {
          this.nyloSplits.cleanup += tickOffset;
        }
        if (this.nyloSplits.boss !== 0) {
          this.nyloSplits.boss += tickOffset;
        }
        break;

      case Stage.TOB_SOTETSEG:
        if (this.soteSplits.MAZE_66 !== 0) {
          this.soteSplits.MAZE_66 += tickOffset;
        }
        if (this.soteSplits.MAZE_33 !== 0) {
          this.soteSplits.MAZE_33 += tickOffset;
        }
        break;

      case Stage.TOB_XARPUS:
        if (this.xarpusSplits.exhumes !== 0) {
          this.xarpusSplits.exhumes += tickOffset;
        }
        if (this.xarpusSplits.screech !== 0) {
          this.xarpusSplits.screech += tickOffset;
        }
        break;

      case Stage.TOB_VERZIK:
        if (this.verzikSplits.p1 !== 0) {
          this.verzikSplits.p1 += tickOffset;
        }
        if (this.verzikSplits.reds !== 0) {
          this.verzikSplits.reds += tickOffset;
        }
        if (this.verzikSplits.p2 !== 0) {
          this.verzikSplits.p2 += tickOffset;
        }
        break;
    }
  }

  private async updateDatabaseFields(updateCallback: (document: any) => void) {
    const record = await RaidModel.findOne({ _id: this.id });
    if (record !== null) {
      updateCallback(record);
      record.save();
    }
  }

  private async updatePartyPbs(
    type: PersonalBestType,
    ticks: number,
  ): Promise<void> {
    if (this.mode === ChallengeMode.NO_MODE) {
      return;
    }

    await Players.updatePersonalBests(
      this.party,
      this.id,
      tobPbForMode(type, this.mode),
      this.getScale(),
      ticks,
    );
  }

  private async flushRoomEvents(): Promise<void> {
    if (this.stageEvents.length > 0) {
      RoomEvent.insertMany(this.stageEvents.map(protoToEvent));
    }
    this.stageEvents = [];
  }
}
