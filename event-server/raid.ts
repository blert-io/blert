import {
  BloatSplits,
  ChallengeMode,
  ChallengeStatus,
  EquipmentSlot,
  Event,
  EventType,
  MaidenCrab,
  MaidenCrabPosition,
  MaidenCrabSpawn,
  MaidenSplits,
  Maze,
  Npc,
  NpcAttack,
  NpcDeathEvent,
  NpcSpawnEvent,
  Nylo,
  NyloSpawn,
  NyloSplits,
  NyloStyle,
  NyloWaveSpawnEvent,
  NyloWaveStallEvent,
  PersonalBestType,
  PlayerAttack,
  PlayerAttackEvent,
  PlayerDeathEvent,
  PlayerInfo,
  PlayerUpdateEvent,
  PrimaryMeleeGear,
  RecordedRaidModel,
  RecordingType,
  Room,
  RoomNpc,
  RoomNpcType,
  SoteMazeProcEvent,
  SoteSplits,
  Stage,
  StageStatus,
  StageUpdateEvent,
  VerzikAttackStyle,
  VerzikAttackStyleEvent,
  VerzikCrab,
  VerzikCrabSpawn,
  VerzikPhase,
  VerzikPhaseEvent,
  VerzikSplits,
  XarpusPhase,
  XarpusPhaseEvent,
  XarpusSplits,
  tobPbForMode,
} from '@blert/common';
import { RaidModel, RoomEvent } from '@blert/common';

import Client from './client';
import { Players } from './players';
import { priceTracker } from './price-tracker';

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
  private mode: ChallengeMode | null;
  private party: string[];
  private partyInfo: PlayerInfo[];
  private startTime: number;
  private challengeStatus: ChallengeStatus;
  private completedRooms: number;
  private totalRoomTicks: number;
  private overallTicks: number;

  private playerInfoUpdated: Set<string>;

  private stage: Stage;
  private room: Room; // TODO(frolv): Replace with stage.
  private stageStatus: StageStatus;
  private roomTick: number;
  private roomEvents: Event[];
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
    this.totalRoomTicks = 0;
    this.overallTicks = 0;

    this.playerInfoUpdated = new Set();

    this.stage = Stage.TOB_MAIDEN;
    this.room = Room.MAIDEN;
    this.stageStatus = StageStatus.ENTERED;
    this.roomTick = 0;
    this.roomEvents = [];
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
      totalRoomTicks: 0,
    });
    await record.save();
  }

  public async finish(): Promise<void> {
    if (this.state === State.STARTING) {
      console.log(`Raid ${this.id} ended before Maiden; deleting record`);
      await Promise.all([
        RaidModel.deleteOne({ _id: this.id }),
        RecordedRaidModel.deleteMany({ raidId: this.id }),
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
        this.updatePartyPbs(
          PersonalBestType.TOB_CHALLENGE,
          this.totalRoomTicks,
        ),
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
    switch (event.type) {
      case EventType.STAGE_UPDATE:
        await this.handleRoomStatusUpdate(event as StageUpdateEvent);
        break;

      default:
        if (event.room !== this.room) {
          console.error(
            `Raid ${this.id} got event ${event.type} for room ${event.room} but is in room ${this.room}`,
          );
          return;
        }

        const writeToDb = await this.updateRaidStatus(event);

        // Batch and flush events once per tick to reduce database writes.
        if (event.tick === this.roomTick) {
          if (writeToDb) {
            this.roomEvents.push(event);
          }
        } else if (event.tick > this.roomTick) {
          await this.flushRoomEvents();
          if (writeToDb) {
            this.roomEvents.push(event);
          }
          this.roomTick = event.tick;
        } else {
          console.error(
            `Raid ${this.id} got event ${event.type} for tick ${event.tick} (current=${this.roomTick})`,
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

  private async handleRoomStatusUpdate(event: StageUpdateEvent): Promise<void> {
    if (!event.room) {
      return;
    }

    switch (event.stageUpdate.status) {
      case StageStatus.STARTED:
        if (this.state === State.STARTING) {
          await this.start();
        }
        if (this.stageStatus === StageStatus.ENTERED) {
          // A transition from ENTERED -> STARTED has already reset the room.
          // Don't clear any data received afterwards, unless the room is new.
          if (this.room === event.room) {
            break;
          }
        }
      // A transition from any other state to STARTED should fall through
      // and reset all room data.
      case StageStatus.ENTERED:
        this.room = event.room;
        this.roomEvents = [];
        this.roomTick = 0;
        this.deathsInRoom = [];
        this.queuedPbUpdates = [];
        this.npcs.clear();

        await this.updateDatabaseFields((record) => {
          record.stage = this.stage;
        });
        break;

      case StageStatus.WIPED:
      case StageStatus.COMPLETED:
        if (event.room === this.room) {
          this.handleRoomFinished(event);
        } else {
          console.error(
            `Raid ${this.id} got status ${event.stageUpdate.status} for room ` +
              `${event.room} but is in room ${this.room}`,
          );
        }
        break;
    }

    this.stageStatus = event.stageUpdate.status;
  }

  private async handleRoomFinished(event: StageUpdateEvent): Promise<void> {
    // Set the appropriate status if the raid were to be finished at this
    // point.
    this.challengeStatus =
      event.stageUpdate.status === StageStatus.WIPED
        ? ChallengeStatus.WIPED
        : ChallengeStatus.RESET;
    this.completedRooms++;
    this.totalRoomTicks += event.tick;

    const promises = [];

    let firstTick = 0;
    if (!event.stageUpdate.accurate) {
      const missingTicks = event.tick - this.roomTick;
      console.log(
        `Raid ${this.id} lost ${missingTicks} ticks in room ${event.room}`,
      );
      firstTick = missingTicks;

      this.correctRoomDataForTickOffset(missingTicks);

      promises.push(
        RoomEvent.updateMany(
          {
            raidId: this.id,
            room: event.room,
          },
          { $inc: { tick: missingTicks } },
        ),
      );
      promises.push(
        RoomEvent.updateMany(
          {
            raidId: this.id,
            room: event.room,
            type: EventType.PLAYER_UPDATE,
          },
          { $inc: { 'player.offCooldownTick': missingTicks } },
        ),
      );
    }

    promises.push(
      this.updateDatabaseFields((record) => {
        record.partyInfo = this.partyInfo;
        record.totalRoomTicks += event.tick;
        record.totalDeaths += this.deathsInRoom.length;
        record.rooms[event.room!] = {
          firstTick,
          roomTicks: event.tick,
          deaths: this.deathsInRoom,
          npcs: this.npcs,
        };

        switch (this.room) {
          case Room.MAIDEN:
            record.rooms[Room.MAIDEN].splits = this.maidenSplits;
            break;
          case Room.BLOAT:
            record.rooms[Room.BLOAT].splits = this.bloatSplits;
            break;
          case Room.NYLOCAS:
            record.rooms[Room.NYLOCAS].splits = this.nyloSplits;
            record.rooms[Room.NYLOCAS].stalledWaves = this.stalledNyloWaves;
            break;
          case Room.SOTETSEG:
            record.rooms[Room.SOTETSEG].splits = this.soteSplits;
            break;
          case Room.XARPUS:
            record.rooms[Room.XARPUS].splits = this.xarpusSplits;
            break;
          case Room.VERZIK:
            record.rooms[Room.VERZIK].splits = this.verzikSplits;
            record.rooms[Room.VERZIK].redCrabSpawns =
              this.verzikRedSpawns.length;
            break;
        }
      }),
      this.flushRoomEvents(),
    );

    if (event.stageUpdate.accurate) {
      // Only update personal bests if the room timer is accurate.
      this.queuedPbUpdates.forEach((update) => {
        promises.push(this.updatePartyPbs(update.pbType, update.pbTime));
      });

      if (event.stageUpdate.status === StageStatus.COMPLETED) {
        let pbType;
        switch (this.room) {
          case Room.MAIDEN:
            pbType = PersonalBestType.TOB_MAIDEN;
            break;
          case Room.BLOAT:
            pbType = PersonalBestType.TOB_BLOAT;
            break;
          case Room.NYLOCAS:
            pbType = PersonalBestType.TOB_NYLO_ROOM;
            promises.push(
              this.updatePartyPbs(
                PersonalBestType.TOB_NYLO_BOSS,
                event.tick - this.nyloSplits.boss,
              ),
            );
            break;
          case Room.SOTETSEG:
            pbType = PersonalBestType.TOB_SOTETSEG;
            break;
          case Room.XARPUS:
            pbType = PersonalBestType.TOB_XARPUS;
            break;
          case Room.VERZIK:
            pbType = PersonalBestType.TOB_VERZIK_ROOM;
            promises.push(
              this.updatePartyPbs(
                PersonalBestType.TOB_VERZIK_P3,
                event.tick - (this.verzikSplits.p2 + 6),
              ),
            );
            break;
        }

        promises.push(this.updatePartyPbs(pbType, event.tick));
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
    switch (event.type) {
      case EventType.PLAYER_UPDATE:
        const updateEvent = event as PlayerUpdateEvent;
        if (!this.playerInfoUpdated.has(updateEvent.player.name)) {
          this.tryDetermineGear(updateEvent);
        }
        return true;

      case EventType.PLAYER_DEATH:
        const deathEvent = event as PlayerDeathEvent;
        this.deathsInRoom.push(deathEvent.player.name);
        Players.updateStats(deathEvent.player.name, (stats) => {
          stats.deaths += 1;

          if (event.room === Room.MAIDEN) {
            stats.deathsMaiden += 1;
          } else if (event.room === Room.BLOAT) {
            stats.deathsBloat += 1;
          } else if (event.room === Room.NYLOCAS) {
            stats.deathsNylocas += 1;
          } else if (event.room === Room.SOTETSEG) {
            stats.deathsSotetseg += 1;
          } else if (event.room === Room.XARPUS) {
            stats.deathsXarpus += 1;
          } else if (event.room === Room.VERZIK) {
            stats.deathsVerzik += 1;
          }
        });
        break;

      case EventType.PLAYER_ATTACK:
        await this.handlePlayerAttack(event as PlayerAttackEvent);
        break;

      case EventType.NPC_SPAWN:
        await this.handleNpcSpawn(event as NpcSpawnEvent);
        break;

      case EventType.NPC_DEATH:
        const npcDeathEvent = event as NpcDeathEvent;
        let npc = this.npcs.get(npcDeathEvent.npc.roomId.toString());
        if (npc !== undefined) {
          npc.deathTick = event.tick;
          npc.deathPoint = { x: event.xCoord, y: event.yCoord };
        }
        break;

      case EventType.TOB_BLOAT_DOWN:
        this.bloatSplits.downTicks.push(event.tick);
        break;

      case EventType.TOB_NYLO_WAVE_SPAWN:
        const nyloWaveSpawnEvent = event as NyloWaveSpawnEvent;
        if (nyloWaveSpawnEvent.nyloWave.wave === 20) {
          this.nyloSplits.capIncrease = event.tick;
        } else if (nyloWaveSpawnEvent.nyloWave.wave === 31) {
          this.nyloSplits.waves = event.tick;
        }
        break;

      case EventType.TOB_NYLO_WAVE_STALL:
        const nyloWaveStallEvent = event as NyloWaveStallEvent;
        this.stalledNyloWaves.push(nyloWaveStallEvent.nyloWave.wave);
        break;

      case EventType.TOB_NYLO_CLEANUP_END:
        this.nyloSplits.cleanup = event.tick;
        break;

      case EventType.TOB_NYLO_BOSS_SPAWN:
        this.nyloSplits.boss = event.tick;
        this.queuedPbUpdates.push({
          pbType: PersonalBestType.TOB_NYLO_BOSS,
          pbTime: event.tick,
        });
        break;

      case EventType.TOB_SOTE_MAZE_PROC:
        const mazeProcEvent = event as SoteMazeProcEvent;
        if (mazeProcEvent.soteMaze.maze === Maze.MAZE_66) {
          this.soteSplits.MAZE_66 = event.tick;
        } else {
          this.soteSplits.MAZE_33 = event.tick;
        }
        break;

      case EventType.TOB_XARPUS_PHASE:
        const xarpusPhaseEvent = event as XarpusPhaseEvent;
        if (xarpusPhaseEvent.xarpusPhase === XarpusPhase.P2) {
          this.xarpusSplits.exhumes = event.tick;
        } else if (xarpusPhaseEvent.xarpusPhase === XarpusPhase.P3) {
          this.xarpusSplits.screech = event.tick;
        }
        break;

      case EventType.TOB_VERZIK_PHASE:
        const verzikPhaseEvent = event as VerzikPhaseEvent;
        if (verzikPhaseEvent.verzikPhase === VerzikPhase.P2) {
          this.verzikSplits.p1 = event.tick;
          this.queuedPbUpdates.push({
            pbType: PersonalBestType.TOB_VERZIK_P1,
            pbTime: event.tick,
          });
        } else if (verzikPhaseEvent.verzikPhase === VerzikPhase.P3) {
          this.verzikSplits.p2 = event.tick;
          if (this.verzikSplits.p1 !== 0) {
            this.queuedPbUpdates.push({
              pbType: PersonalBestType.TOB_VERZIK_P2,
              pbTime: event.tick - (this.verzikSplits.p1 + 13),
            });
          }
        }
        break;

      case EventType.TOB_VERZIK_ATTACK_STYLE:
        // Update the previously-written NPC_ATTACK event.
        const verzikAttackStyle = event as VerzikAttackStyleEvent;

        const record = await RoomEvent.findOne({
          raidId: this.id,
          type: EventType.NPC_ATTACK,
          tick: verzikAttackStyle.verzikAttack.npcAttackTick,
          room: Room.VERZIK,
          'npcAttack.attack': NpcAttack.TOB_VERZIK_P3_AUTO,
        });

        if (record !== null) {
          switch (verzikAttackStyle.verzikAttack.style) {
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

  private async handlePlayerAttack(event: PlayerAttackEvent): Promise<void> {
    const username = event.player.name;
    const attack = event.attack;

    switch (attack.type) {
      case PlayerAttack.BGS_SMACK:
      case PlayerAttack.HAMMER_BOP:
        if (this.room === Room.VERZIK) {
          if (
            attack.target !== undefined &&
            Npc.isVerzikMatomenos(attack.target.id)
          ) {
            // Can 6t a red crab to tick fix; not a troll.
            return;
          }
        }

        if (
          this.room === Room.NYLOCAS &&
          this.nyloSplits.waves !== 0 &&
          this.nyloSplits.cleanup === 0
        ) {
          // Ok to BGS smack during cleanup.
          if (attack.target === undefined || Npc.isNylocas(attack.target.id)) {
            return;
          }
        }

        await Players.updateStats(username, (stats) => {
          if (attack.type === PlayerAttack.BGS_SMACK) {
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
        if (attack.weapon !== undefined) {
          try {
            chinPrice = await priceTracker.getPrice(attack.weapon.id);
          } catch (e) {
            chinPrice = 0;
          }
        }

        const isWrongThrowDistance =
          attack.distanceToTarget !== -1 &&
          (attack.distanceToTarget < 4 || attack.distanceToTarget > 6);

        await Players.updateStats(username, (stats) => {
          stats.chinsThrown += 1;
          stats.chinsThrownValue += chinPrice;

          if (event.room === Room.MAIDEN) {
            stats.chinsThrownMaiden += 1;
          } else if (event.room === Room.NYLOCAS) {
            stats.chinsThrownNylocas += 1;
          }

          if (attack.type === PlayerAttack.CHIN_BLACK) {
            stats.chinsThrownBlack += 1;
          } else if (attack.type === PlayerAttack.CHIN_RED) {
            stats.chinsThrownRed += 1;
          } else if (attack.type === PlayerAttack.CHIN_GREY) {
            stats.chinsThrownGrey += 1;
          }

          if (attack.target !== undefined && isWrongThrowDistance) {
            // Only consider incorrect throw distances on Maiden crabs.
            if (Npc.isMaidenMatomenos(attack.target.id)) {
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
  private async handleNpcSpawn(event: NpcSpawnEvent): Promise<void> {
    const { id, roomId, type } = event.npc;

    const npcCommon = {
      type,
      spawnNpcId: id,
      roomId,
      spawnTick: event.tick,
      spawnPoint: { x: event.xCoord, y: event.yCoord },
      deathTick: 0,
      deathPoint: { x: 0, y: 0 },
    };

    if (Npc.isVerzikMatomenos(id)) {
      if (this.verzikRedSpawns.length === 0) {
        // First red spawn is recorded as a room split.
        this.verzikSplits.reds = event.tick;
        this.verzikRedSpawns.push(event.tick);
      } else if (
        this.verzikRedSpawns[this.verzikRedSpawns.length - 1] !== event.tick
      ) {
        // A new spawn occurred.
        this.verzikRedSpawns.push(event.tick);
      }
    }

    if (event.npc.maidenCrab !== undefined) {
      switch (event.npc.maidenCrab.spawn) {
        case MaidenCrabSpawn.SEVENTIES:
          this.maidenSplits.SEVENTIES = event.tick;
          break;
        case MaidenCrabSpawn.FIFTIES:
          this.maidenSplits.FIFTIES = event.tick;
          break;
        case MaidenCrabSpawn.THIRTIES:
          this.maidenSplits.THIRTIES = event.tick;
          break;
      }
      const crab: MaidenCrab = {
        ...npcCommon,
        type: RoomNpcType.MAIDEN_CRAB,
        maidenCrab: event.npc.maidenCrab,
      };
      this.npcs.set(event.npc.roomId.toString(), crab);
    } else if (event.npc.nylo !== undefined) {
      const nylo: Nylo = {
        ...npcCommon,
        type: RoomNpcType.NYLO,
        nylo: event.npc.nylo,
      };
      this.npcs.set(event.npc.roomId.toString(), nylo);
    } else if (event.npc.verzikCrab !== undefined) {
      const crab: VerzikCrab = {
        ...npcCommon,
        type: RoomNpcType.VERZIK_CRAB,
        verzikCrab: event.npc.verzikCrab,
      };
      this.npcs.set(event.npc.roomId.toString(), crab);
    } else {
      this.npcs.set(event.npc.roomId.toString(), npcCommon);
    }
  }

  private async tryDetermineGear(event: PlayerUpdateEvent): Promise<void> {
    const equipment = event.player.equipment;
    if (equipment === undefined) {
      return;
    }

    const torso = equipment[EquipmentSlot.TORSO];
    const helm = equipment[EquipmentSlot.HEAD];
    let gear: PrimaryMeleeGear | null = null;

    if (torso !== undefined) {
      switch (torso.id) {
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
      (helm.id === VOID_MELEE_HELM_ID || helm.id === VOID_MELEE_HELM_OR_ID)
    ) {
      gear = PrimaryMeleeGear.ELITE_VOID;
    }

    if (gear !== null) {
      this.playerInfoUpdated.add(event.player.name);
      this.partyInfo[this.party.indexOf(event.player.name)].gear = gear;
    }
  }

  /**
   * Corrects any recorded splits and other room information that were affected
   * by tick loss.
   *
   * @param tickOffset The number of ticks lost.
   */
  private correctRoomDataForTickOffset(tickOffset: number): void {
    this.npcs.forEach((npc) => {
      npc.spawnTick += tickOffset;
      npc.deathTick += tickOffset;
    });

    switch (this.room) {
      case Room.MAIDEN:
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

      case Room.BLOAT:
        this.bloatSplits.downTicks = this.bloatSplits.downTicks.map(
          (tick) => tick + tickOffset,
        );
        break;

      case Room.NYLOCAS:
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

      case Room.SOTETSEG:
        if (this.soteSplits.MAZE_66 !== 0) {
          this.soteSplits.MAZE_66 += tickOffset;
        }
        if (this.soteSplits.MAZE_33 !== 0) {
          this.soteSplits.MAZE_33 += tickOffset;
        }
        break;

      case Room.XARPUS:
        if (this.xarpusSplits.exhumes !== 0) {
          this.xarpusSplits.exhumes += tickOffset;
        }
        if (this.xarpusSplits.screech !== 0) {
          this.xarpusSplits.screech += tickOffset;
        }
        break;

      case Room.VERZIK:
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
    if (this.mode === null) {
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
    if (this.roomEvents.length > 0) {
      RoomEvent.insertMany(this.roomEvents);
    }
    this.roomEvents = [];
  }

  public static async migrateRaids() {
    await RaidModel.updateMany(
      {},
      {
        $rename: {
          mode: 'modeString',
          status: 'statusString',
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
        doc.type = updateEventType(doc.typeString);
        doc.stage = roomToStage(doc.roomString as Room);

        switch (doc.type) {
          case EventType.PLAYER_ATTACK:
            doc.attack.type = updatePlayerAttack(doc.attack.typeString);
            break;

          case EventType.NPC_SPAWN:
          case EventType.NPC_UPDATE:
          case EventType.NPC_DEATH:
            doc.npc.type = updateNpcType(doc.npc.typeString);
            if (doc.npc.type === RoomNpcType.MAIDEN_CRAB) {
              doc.npc.maidenCrab!.spawn = updateMaidenCrabSpawn(
                doc.npc.maidenCrab!.spawnString,
              );
              doc.npc.maidenCrab!.position = updateMaidenCrabPosition(
                doc.npc.maidenCrab!.positionString,
              );
            }
            if (doc.npc.type === RoomNpcType.NYLO) {
              doc.npc.nylo!.style = updateNyloStyle(doc.npc.nylo!.styleString);
              doc.npc.nylo!.spawnType = updateNyloSpawnType(
                doc.npc.nylo!.spawnTypeString,
              );
            }
            if (doc.npc.type === RoomNpcType.VERZIK_CRAB) {
              doc.npc.verzikCrab!.phase = updateVerzikPhase(
                doc.npc.verzikCrab!.phaseString,
              );
              doc.npc.verzikCrab!.spawn = updateVerzikCrabSpawn(
                doc.npc.verzikCrab!.spawnString,
              );
            }
            break;

          case EventType.NPC_ATTACK:
            doc.npcAttack.attack = updateNpcAttack(doc.npcAttack.attackString);
            break;

          case EventType.TOB_SOTE_MAZE_PROC:
            doc.soteMaze.maze = updateSoteMaze(doc.soteMaze.mazeString);
            break;

          case EventType.TOB_XARPUS_PHASE:
            doc.xarpusPhase = updateXarpusPhase(doc.xarpusPhaseString);
            break;

          case EventType.TOB_VERZIK_PHASE:
            doc.verzikPhase = updateVerzikPhase(doc.verzikPhaseString);
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

function roomToStage(room: Room): Stage {
  switch (room) {
    case Room.MAIDEN:
      return Stage.TOB_MAIDEN;
    case Room.BLOAT:
      return Stage.TOB_BLOAT;
    case Room.NYLOCAS:
      return Stage.TOB_NYLOCAS;
    case Room.SOTETSEG:
      return Stage.TOB_SOTETSEG;
    case Room.XARPUS:
      return Stage.TOB_XARPUS;
    case Room.VERZIK:
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
