import {
  BloatSplits,
  ChallengeMode,
  ChallengeStatus,
  EventType,
  MaidenCrab,
  MaidenCrabPosition,
  MaidenCrabSpawn,
  MaidenSplits,
  Maze,
  Npc,
  NpcAttack,
  Nylo,
  NyloSpawn,
  NyloSplits,
  NyloStyle,
  PersonalBestType,
  PlayerAttack,
  PlayerInfo,
  PrimaryMeleeGear,
  RecordedRaidModel,
  RecordingType,
  RoomNpc,
  RoomNpcType,
  SoteSplits,
  Stage,
  StageStatus,
  VerzikAttackStyle,
  VerzikCrab,
  VerzikCrabSpawn,
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
        RecordedRaidModel.deleteMany({ cId: this.id }),
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

    const recordedRaid = new RecordedRaidModel({
      recorderId: client.getUserId(),
      raidId: this.id,
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

        await this.updateDatabaseFields((record) => {
          record.stage = this.stage;
        });
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
          pbType: PersonalBestType.TOB_NYLO_BOSS,
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
      console.log(`Flushing ${this.stageEvents.length} stage events`);
      // if (this.roomTick % 20 === 0) {
      //   console.log(this.roomEvents.map(protoToEvent));
      // }
      RoomEvent.insertMany(this.stageEvents.map(protoToEvent));
    }
    this.stageEvents = [];
  }

  public static async migrateRaids() {
    await RaidModel.updateMany(
      {},
      {
        $rename: {
          mode: 'modeString',
          status: 'statusString',
          totalRoomTicks: 'totalTicks',
          'rooms.MAIDEN': 'rooms.maiden',
          'rooms.BLOAT': 'rooms.bloat',
          'rooms.NYLOCAS': 'rooms.nylocas',
          'rooms.SOTETSEG': 'rooms.sotetseg',
          'rooms.XARPUS': 'rooms.xarpus',
          'rooms.VERZIK': 'rooms.verzik',
        },
      },
    );

    const raids = await RaidModel.find();
    raids.forEach(async (raid) => {
      const [stage, status] = updateStatus(raid.statusString);
      raid.mode = updateMode(raid.modeString);
      raid.stage = stage;
      raid.status = status;

      const maidenNpcs = raid.rooms.MAIDEN?.npcs as unknown as Map<string, any>;
      if (maidenNpcs) {
        const npcs = Array.from(maidenNpcs.values());
        maidenNpcs.clear();
        npcs.forEach((npc) => {
          npc.type = updateNpcType(npc.type);

          if (npc.type === RoomNpcType.MAIDEN_CRAB) {
            npc.maidenCrab.spawn = updateMaidenCrabSpawn(npc.maidenCrab.spawn);
            npc.maidenCrab.position = updateMaidenCrabPosition(
              npc.maidenCrab.position,
            );
          }

          maidenNpcs.set(npc.roomId.toString(), npc);
        });
      }

      const bloatNpcs = raid.rooms.BLOAT?.npcs as unknown as Map<string, any>;
      if (bloatNpcs) {
        const npcs = Array.from(bloatNpcs.values());
        bloatNpcs.clear();
        npcs.forEach((npc) => {
          npc.type = updateNpcType(npc.type);
          bloatNpcs.set(npc.roomId.toString(), npc);
        });
      }

      const nyloNpcs = raid.rooms.NYLOCAS?.npcs as unknown as Map<string, any>;
      if (nyloNpcs) {
        const npcs = Array.from(nyloNpcs.values());
        nyloNpcs.clear();
        npcs.forEach((npc) => {
          npc.type = updateNpcType(npc.type);

          if (npc.type === RoomNpcType.NYLO) {
            npc.nylo.style = updateNyloStyle(npc.nylo.style);
            npc.nylo.spawnType = updateNyloSpawnType(npc.nylo.spawnType);
          }

          nyloNpcs.set(npc.roomId.toString(), npc);
        });
      }

      const soteNpcs = raid.rooms.SOTETSEG?.npcs as unknown as Map<string, any>;
      if (soteNpcs) {
        const npcs = Array.from(soteNpcs.values());
        soteNpcs.clear();
        npcs.forEach((npc) => {
          npc.type = updateNpcType(npc.type);
          soteNpcs.set(npc.roomId.toString(), npc);
        });
      }

      const xarpusNpcs = raid.rooms.XARPUS?.npcs as unknown as Map<string, any>;
      if (xarpusNpcs) {
        const npcs = Array.from(xarpusNpcs.values());
        xarpusNpcs.clear();
        npcs.forEach((npc) => {
          npc.type = updateNpcType(npc.type);
          xarpusNpcs.set(npc.roomId.toString(), npc);
        });
      }

      const verzikNpcs = raid.rooms.VERZIK?.npcs as unknown as Map<string, any>;
      if (verzikNpcs) {
        const npcs = Array.from(verzikNpcs.values());
        verzikNpcs.clear();
        npcs.forEach((npc) => {
          npc.type = updateNpcType(npc.type);

          if (npc.type === RoomNpcType.VERZIK_CRAB) {
            npc.verzikCrab.phase = updateVerzikPhase(npc.verzikCrab.phase);
            npc.verzikCrab.spawn = updateVerzikCrabSpawn(npc.verzikCrab.spawn);
          }

          verzikNpcs.set(npc.roomId.toString(), npc);
        });
      }

      await raid.save();
      console.log(`Updated raid ${raid._id}`);
    });

    await RaidModel.updateMany(
      {},
      { $unset: { modeString: 1, statusString: 1 } },
    );
  }

  public static async migrateRoomEvents() {
    console.log('Migrating room events...');
    let startTime = Date.now();
    try {
      await RoomEvent.updateMany(
        {},
        {
          $rename: {
            raidId: 'cId',
            type: 'typeString',
            room: 'roomString',
            bloatStatus: 'bloatDown',
            'attack.type': 'attack.typeString',
            'npc.type': 'npc.typeString',
            'npc.maidenCrab.spawn': 'npc.maidenCrab.spawnString',
            'npc.maidenCrab.position': 'npc.maidenCrab.positionString',
            'npc.nylo.style': 'npc.nylo.styleString',
            'npc.nylo.spawnType': 'npc.nylo.spawnTypeString',
            'npc.verzikCrab.phase': 'npc.verzikCrab.phaseString',
            'npc.verzikCrab.spawn': 'npc.verzikCrab.spawnString',
            'npcAttack.attack': 'npcAttack.attackString',
            'soteMaze.maze': 'soteMaze.mazeString',
            xarpusPhase: 'xarpusPhaseString',
            verzikPhase: 'verzikPhaseString',
            'verzikAttack.style': 'verzikAttack.styleString',
          },
        },
      ).exec();
    } catch (e: any) {
      console.error(e.message);
      return;
    }
    console.log(`Renamed events in ${(Date.now() - startTime) / 1000}s`);

    try {
      await RoomEvent.deleteMany({ typeString: 'VERZIK_REDS_SPAWN' }).exec();
    } catch (e: any) {
      console.log(e);
      console.error('Failed to delete VERZIK_REDS_SPAWN events');
      return;
    }

    let eventsUpdated = 0;
    startTime = Date.now();

    const dummy = await RoomEvent.findOne();
    const dummyArray = [dummy!];
    let currentDocs: typeof dummyArray = [];

    const process = async () => {
      const promises = [];

      for (let doc of currentDocs) {
        doc.type = updateEventType(doc.typeString!);
        doc.stage = roomToStage(doc.roomString!);

        switch (doc.type) {
          case EventType.PLAYER_ATTACK:
            doc.attack.type = updatePlayerAttack(doc.attack.typeString!);
            break;

          case EventType.NPC_SPAWN:
          case EventType.NPC_UPDATE:
          case EventType.NPC_DEATH:
            doc.npc.type = updateNpcType(doc.npc.typeString!);
            if (doc.npc.type === RoomNpcType.MAIDEN_CRAB) {
              doc.npc.maidenCrab!.spawn = updateMaidenCrabSpawn(
                doc.npc.maidenCrab!.spawnString!,
              );
              doc.npc.maidenCrab!.position = updateMaidenCrabPosition(
                doc.npc.maidenCrab!.positionString!,
              );
            }
            if (doc.npc.type === RoomNpcType.NYLO) {
              doc.npc.nylo!.style = updateNyloStyle(doc.npc.nylo!.styleString!);
              doc.npc.nylo!.spawnType = updateNyloSpawnType(
                doc.npc.nylo!.spawnTypeString!,
              );
            }
            if (doc.npc.type === RoomNpcType.VERZIK_CRAB) {
              doc.npc.verzikCrab!.phase = updateVerzikPhase(
                doc.npc.verzikCrab!.phaseString!,
              );
              doc.npc.verzikCrab!.spawn = updateVerzikCrabSpawn(
                doc.npc.verzikCrab!.spawnString!,
              );
            }
            break;

          case EventType.NPC_ATTACK:
            doc.npcAttack.attack = updateNpcAttack(doc.npcAttack.attackString!);
            break;

          case EventType.TOB_SOTE_MAZE_PROC:
            doc.soteMaze.maze = updateSoteMaze(doc.soteMaze.mazeString!);
            break;

          case EventType.TOB_XARPUS_PHASE:
            doc.xarpusPhase = updateXarpusPhase(doc.xarpusPhaseString!);
            break;

          case EventType.TOB_VERZIK_PHASE:
            doc.verzikPhase = updateVerzikPhase(doc.verzikPhaseString!);
            break;

          case EventType.TOB_VERZIK_ATTACK_STYLE:
            console.log('Found a VERZIK_ATTACK_STYLE event, very strange');
            break;
        }

        promises.push(doc.save());
      }

      await Promise.all(promises);
    };

    const cur = RoomEvent.find().cursor();
    for (let doc = await cur.next(); doc != null; doc = await cur.next()) {
      currentDocs.push(doc);
      eventsUpdated++;

      if (currentDocs.length === 100) {
        await process();
        currentDocs = [];
      }

      if (eventsUpdated % 1000 === 0) {
        console.log(
          `Updated ${eventsUpdated} events (${(Date.now() - startTime) / 1000}s)`,
        );
      }
    }

    if (currentDocs.length > 0) {
      await process();
    }

    await RoomEvent.updateMany(
      {},
      {
        $unset: {
          typeString: 1,
          room: 1,
          roomString: 1,
          'player.hitpoints.skill': 1,
          'attack.typeString': 1,
          'npc.typeString': 1,
          'npc.hitpoints.skill': 1,
          'npc.maidenCrab.spawnString': 1,
          'npc.maidenCrab.positionString': 1,
          'npc.nylo.styleString': 1,
          'npc.nylo.spawnTypeString': 1,
          'npc.verzikCrab.phaseString': 1,
          'npc.verzikCrab.spawnString': 1,
          'npcAttack.attackString': 1,
          'soteMaze.mazeString': 1,
          'xarpusPhase.phaseString': 1,
          'verzikPhase.phaseString': 1,
          'verzikAttack.styleString': 1,
        },
      },
    );

    console.log(`Migration complete (${eventsUpdated} events)`);
  }
}

export function updateMode(old: string): ChallengeMode {
  switch (old) {
    case 'ENTRY':
      return ChallengeMode.TOB_ENTRY;
    case 'REGULAR':
      return ChallengeMode.TOB_REGULAR;
    case 'HARD':
      return ChallengeMode.TOB_HARD;
  }
  return ChallengeMode.NO_MODE;
}

function updateStatus(old: string): [Stage, ChallengeStatus] {
  switch (old) {
    case 'IN_PROGRESS':
      return [Stage.TOB_MAIDEN, ChallengeStatus.IN_PROGRESS];
    case 'COMPLETED':
      return [Stage.TOB_VERZIK, ChallengeStatus.COMPLETED];
    case 'MAIDEN_RESET':
      return [Stage.TOB_MAIDEN, ChallengeStatus.RESET];
    case 'BLOAT_RESET':
      return [Stage.TOB_BLOAT, ChallengeStatus.RESET];
    case 'NYLO_RESET':
      return [Stage.TOB_NYLOCAS, ChallengeStatus.RESET];
    case 'SOTE_RESET':
      return [Stage.TOB_SOTETSEG, ChallengeStatus.RESET];
    case 'XARPUS_RESET':
      return [Stage.TOB_XARPUS, ChallengeStatus.RESET];
    case 'MAIDEN_WIPE':
      return [Stage.TOB_MAIDEN, ChallengeStatus.WIPED];
    case 'BLOAT_WIPE':
      return [Stage.TOB_BLOAT, ChallengeStatus.WIPED];
    case 'NYLO_WIPE':
      return [Stage.TOB_NYLOCAS, ChallengeStatus.WIPED];
    case 'SOTE_WIPE':
      return [Stage.TOB_SOTETSEG, ChallengeStatus.WIPED];
    case 'XARPUS_WIPE':
      return [Stage.TOB_XARPUS, ChallengeStatus.WIPED];
    case 'VERZIK_WIPE':
      return [Stage.TOB_VERZIK, ChallengeStatus.WIPED];
  }
  return [Stage.TOB_MAIDEN, ChallengeStatus.IN_PROGRESS];
}

function updateEventType(old: string): EventType {
  switch (old) {
    case 'RAID_START':
      return EventType.CHALLENGE_START;
    case 'RAID_END':
      return EventType.CHALLENGE_END;
    case 'RAID_UPDATE':
      return EventType.CHALLENGE_UPDATE;
    case 'ROOM_STATUS':
      return EventType.STAGE_UPDATE;
    case 'PLAYER_UPDATE':
      return EventType.PLAYER_UPDATE;
    case 'PLAYER_ATTACK':
      return EventType.PLAYER_ATTACK;
    case 'PLAYER_DEATH':
      return EventType.PLAYER_DEATH;
    case 'NPC_SPAWN':
      return EventType.NPC_SPAWN;
    case 'NPC_UPDATE':
      return EventType.NPC_UPDATE;
    case 'NPC_DEATH':
      return EventType.NPC_DEATH;
    case 'NPC_ATTACK':
      return EventType.NPC_ATTACK;
    case 'MAIDEN_CRAB_LEAK':
      return EventType.TOB_MAIDEN_CRAB_LEAK;
    case 'MAIDEN_BLOOD_SPLATS':
      return EventType.TOB_MAIDEN_BLOOD_SPLATS;
    case 'BLOAT_DOWN':
      return EventType.TOB_BLOAT_DOWN;
    case 'BLOAT_UP':
      return EventType.TOB_BLOAT_UP;
    case 'NYLO_WAVE_SPAWN':
      return EventType.TOB_NYLO_WAVE_SPAWN;
    case 'NYLO_WAVE_STALL':
      return EventType.TOB_NYLO_WAVE_STALL;
    case 'NYLO_CLEANUP_END':
      return EventType.TOB_NYLO_CLEANUP_END;
    case 'NYLO_BOSS_SPAWN':
      return EventType.TOB_NYLO_BOSS_SPAWN;
    case 'SOTE_MAZE_PROC':
      return EventType.TOB_SOTE_MAZE_PROC;
    case 'SOTE_MAZE_PATH':
      return EventType.TOB_SOTE_MAZE_PATH;
    case 'XARPUS_PHASE':
      return EventType.TOB_XARPUS_PHASE;
    case 'VERZIK_PHASE':
      return EventType.TOB_VERZIK_PHASE;
    case 'VERZIK_ATTACK_STYLE':
      return EventType.TOB_VERZIK_ATTACK_STYLE;
  }

  return EventType.TOB_VERZIK_ATTACK_STYLE;
}

function roomToStage(room: string): Stage {
  switch (room) {
    case 'MAIDEN':
      return Stage.TOB_MAIDEN;
    case 'BLOAT':
      return Stage.TOB_BLOAT;
    case 'NYLOCAS':
      return Stage.TOB_NYLOCAS;
    case 'SOTETSEG':
      return Stage.TOB_SOTETSEG;
    case 'XARPUS':
      return Stage.TOB_XARPUS;
    case 'VERZIK':
      return Stage.TOB_VERZIK;
  }
  return Stage.UNKNOWN;
}

function updatePlayerAttack(old: string) {
  switch (old) {
    case 'BGS_SMACK':
      return PlayerAttack.BGS_SMACK;
    case 'BGS_SPEC':
      return PlayerAttack.BGS_SPEC;
    case 'BLOWPIPE':
      return PlayerAttack.BLOWPIPE;
    case 'BOWFA':
      return PlayerAttack.BOWFA;
    case 'CHALLY_SPEC':
      return PlayerAttack.CHALLY_SPEC;
    case 'CHALLY_SWIPE':
      return PlayerAttack.CHALLY_SWIPE;
    case 'CHIN_BLACK':
      return PlayerAttack.CHIN_BLACK;
    case 'CHIN_GREY':
      return PlayerAttack.CHIN_GREY;
    case 'CHIN_RED':
      return PlayerAttack.CHIN_RED;
    case 'CLAW_SCRATCH':
      return PlayerAttack.CLAW_SCRATCH;
    case 'CLAW_SPEC':
      return PlayerAttack.CLAW_SPEC;
    case 'DAWN_SPEC':
      return PlayerAttack.DAWN_SPEC;
    case 'DINHS_SPEC':
      return PlayerAttack.DINHS_SPEC;
    case 'FANG':
      return PlayerAttack.FANG_STAB;
    case 'HAMMER_BOP':
      return PlayerAttack.HAMMER_BOP;
    case 'HAMMER_SPEC':
      return PlayerAttack.HAMMER_SPEC;
    case 'HAM_JOINT':
      return PlayerAttack.HAM_JOINT;
    case 'KODAI_BARRAGE':
      return PlayerAttack.KODAI_BARRAGE;
    case 'KODAI_BASH':
      return PlayerAttack.KODAI_BASH;
    case 'RAPIER':
      return PlayerAttack.RAPIER;
    case 'SAELDOR':
      return PlayerAttack.SAELDOR;
    case 'SANG':
      return PlayerAttack.SANG;
    case 'SANG_BARRAGE':
      return PlayerAttack.SANG_BARRAGE;
    case 'SCEPTRE_BARRAGE':
      return PlayerAttack.SCEPTRE_BARRAGE;
    case 'SCYTHE':
      return PlayerAttack.SCYTHE;
    case 'SCYTHE_UNCHARGED':
      return PlayerAttack.SCYTHE_UNCHARGED;
    case 'SHADOW':
      return PlayerAttack.SHADOW;
    case 'SHADOW_BARRAGE':
      return PlayerAttack.SHADOW_BARRAGE;
    case 'SOTD_BARRAGE':
      return PlayerAttack.SOTD_BARRAGE;
    case 'SOULREAPER_AXE':
      return PlayerAttack.SOULREAPER_AXE;
    case 'STAFF_OF_LIGHT_BARRAGE':
      return PlayerAttack.STAFF_OF_LIGHT_BARRAGE;
    case 'STAFF_OF_LIGHT_SWIPE':
      return PlayerAttack.STAFF_OF_LIGHT_SWIPE;
    case 'SWIFT':
      return PlayerAttack.SWIFT_BLADE;
    case 'TENT_WHIP':
      return PlayerAttack.TENT_WHIP;
    case 'TOXIC_TRIDENT':
      return PlayerAttack.TOXIC_TRIDENT;
    case 'TOXIC_TRIDENT_BARRAGE':
      return PlayerAttack.TOXIC_TRIDENT_BARRAGE;
    case 'TOXIC_STAFF_BARRAGE':
      return PlayerAttack.TOXIC_STAFF_BARRAGE;
    case 'TOXIC_STAFF_SWIPE':
      return PlayerAttack.TOXIC_STAFF_SWIPE;
    case 'TRIDENT':
      return PlayerAttack.TRIDENT;
    case 'TRIDENT_BARRAGE':
      return PlayerAttack.TRIDENT_BARRAGE;
    case 'TWISTED_BOW':
      return PlayerAttack.TWISTED_BOW;
    case 'VOLATILE_NM_BARRAGE':
      return PlayerAttack.VOLATILE_NM_BARRAGE;
    case 'ZCB':
      return PlayerAttack.ZCB_SPEC;

    case 'UNKNOWN_BARRAGE':
      return PlayerAttack.UNKNOWN_BARRAGE;
    case 'UNKNOWN_BOW':
      return PlayerAttack.UNKNOWN_BOW;
    case 'UNKNOWN_POWERED_STAFF':
      return PlayerAttack.UNKNOWN_POWERED_STAFF;
    case 'UNKNOWN':
      return PlayerAttack.UNKNOWN;
  }

  return PlayerAttack.UNKNOWN;
}

function updateNpcType(old: string): RoomNpcType {
  switch (old) {
    case 'MAIDEN_CRAB':
      return RoomNpcType.MAIDEN_CRAB;
    case 'NYLO':
      return RoomNpcType.NYLO;
    case 'VERZIK_CRAB':
      return RoomNpcType.VERZIK_CRAB;
    default:
      return RoomNpcType.BASIC;
  }
}

function updateMaidenCrabSpawn(old: string): MaidenCrabSpawn {
  switch (old) {
    case 'SEVENTIES':
      return MaidenCrabSpawn.SEVENTIES;
    case 'FIFTIES':
      return MaidenCrabSpawn.FIFTIES;
    case 'THIRTIES':
    default:
      return MaidenCrabSpawn.THIRTIES;
  }
}

function updateMaidenCrabPosition(old: string): MaidenCrabPosition {
  switch (old) {
    case 'S1':
      return MaidenCrabPosition.S1;
    case 'S2':
      return MaidenCrabPosition.S2;
    case 'S3':
      return MaidenCrabPosition.S3;
    case 'S4_INNER':
      return MaidenCrabPosition.S4_INNER;
    case 'S4_OUTER':
      return MaidenCrabPosition.S4_OUTER;
    case 'N1':
      return MaidenCrabPosition.N1;
    case 'N2':
      return MaidenCrabPosition.N2;
    case 'N3':
      return MaidenCrabPosition.N3;
    case 'N4_INNER':
      return MaidenCrabPosition.N4_INNER;
    case 'N4_OUTER':
      return MaidenCrabPosition.N4_OUTER;
  }

  return MaidenCrabPosition.S1;
}

function updateNyloStyle(old: string): NyloStyle {
  switch (old) {
    case 'MELEE':
      return NyloStyle.MELEE;
    case 'RANGE':
      return NyloStyle.RANGE;
    case 'MAGE':
      return NyloStyle.MAGE;
  }

  return NyloStyle.MELEE;
}

function updateNyloSpawnType(old: string): NyloSpawn {
  switch (old) {
    case 'WEST':
      return NyloSpawn.WEST;
    case 'EAST':
      return NyloSpawn.EAST;
    case 'SOUTH':
      return NyloSpawn.SOUTH;
  }

  return NyloSpawn.SPLIT;
}

function updateVerzikPhase(old: string): VerzikPhase {
  switch (old) {
    case 'P1':
      return VerzikPhase.P1;
    case 'P2':
      return VerzikPhase.P2;
    case 'P3':
      return VerzikPhase.P3;
  }

  return VerzikPhase.IDLE;
}

function updateVerzikCrabSpawn(old: string): VerzikCrabSpawn {
  switch (old) {
    case 'NORTH':
      return VerzikCrabSpawn.NORTH;
    case 'NORTHEAST':
      return VerzikCrabSpawn.NORTHEAST;
    case 'NORTHWEST':
      return VerzikCrabSpawn.NORTHWEST;
    case 'EAST':
      return VerzikCrabSpawn.EAST;
    case 'SOUTH':
      return VerzikCrabSpawn.SOUTH;
    case 'SOUTHEAST':
      return VerzikCrabSpawn.SOUTHEAST;
    case 'SOUTHWEST':
      return VerzikCrabSpawn.SOUTHWEST;
    case 'WEST':
      return VerzikCrabSpawn.WEST;
  }

  return VerzikCrabSpawn.UNKNOWN;
}

function updateNpcAttack(old: string): NpcAttack {
  switch (old) {
    case 'MAIDEN_AUTO':
      return NpcAttack.TOB_MAIDEN_AUTO;
    case 'MAIDEN_BLOOD_THROW':
      return NpcAttack.TOB_MAIDEN_BLOOD_THROW;
    case 'BLOAT_STOMP':
      return NpcAttack.TOB_BLOAT_STOMP;
    case 'NYLO_BOSS_MELEE':
      return NpcAttack.TOB_NYLO_BOSS_MELEE;
    case 'NYLO_BOSS_RANGE':
      return NpcAttack.TOB_NYLO_BOSS_RANGE;
    case 'NYLO_BOSS_MAGE':
      return NpcAttack.TOB_NYLO_BOSS_MAGE;
    case 'SOTE_MELEE':
      return NpcAttack.TOB_SOTE_MELEE;
    case 'SOTE_BALL':
      return NpcAttack.TOB_SOTE_BALL;
    case 'SOTE_DEATH_BALL':
      return NpcAttack.TOB_SOTE_DEATH_BALL;
    case 'XARPUS_SPIT':
      return NpcAttack.TOB_XARPUS_SPIT;
    case 'XARPUS_TURN':
      return NpcAttack.TOB_XARPUS_TURN;
    case 'VERZIK_P1_AUTO':
      return NpcAttack.TOB_VERZIK_P1_AUTO;
    case 'VERZIK_P2_BOUNCE':
      return NpcAttack.TOB_VERZIK_P2_BOUNCE;
    case 'VERZIK_P2_CABBAGE':
      return NpcAttack.TOB_VERZIK_P2_CABBAGE;
    case 'VERZIK_P2_ZAP':
      return NpcAttack.TOB_VERZIK_P2_ZAP;
    case 'VERZIK_P2_PURPLE':
      return NpcAttack.TOB_VERZIK_P2_PURPLE;
    case 'VERZIK_P2_MAGE':
      return NpcAttack.TOB_VERZIK_P2_MAGE;
    case 'VERZIK_P3_AUTO':
      return NpcAttack.TOB_VERZIK_P3_AUTO;
    case 'VERZIK_P3_MELEE':
      return NpcAttack.TOB_VERZIK_P3_MELEE;
    case 'VERZIK_P3_RANGE':
      return NpcAttack.TOB_VERZIK_P3_RANGE;
    case 'VERZIK_P3_MAGE':
      return NpcAttack.TOB_VERZIK_P3_MAGE;
    case 'VERZIK_P3_WEBS':
      return NpcAttack.TOB_VERZIK_P3_WEBS;
    case 'VERZIK_P3_YELLOWS':
      return NpcAttack.TOB_VERZIK_P3_YELLOWS;
    case 'VERZIK_P3_BALL':
      return NpcAttack.TOB_VERZIK_P3_BALL;
  }

  return NpcAttack.UNKNOWN;
}

function updateSoteMaze(old: string): Maze {
  switch (old) {
    case 'MAZE_33':
      return Maze.MAZE_33;
    default:
      return Maze.MAZE_66;
  }
}

function updateXarpusPhase(old: string): XarpusPhase {
  switch (old) {
    case 'P1':
      return XarpusPhase.P1;
    case 'P2':
      return XarpusPhase.P2;
    default:
      return XarpusPhase.P3;
  }
}
