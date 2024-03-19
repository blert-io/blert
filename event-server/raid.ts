import {
  BloatSplits,
  EquipmentSlot,
  Event,
  EventType,
  MaidenCrab,
  MaidenCrabSpawn,
  MaidenSplits,
  Maze,
  Mode,
  Npc,
  NpcAttack,
  NpcDeathEvent,
  NpcSpawnEvent,
  Nylo,
  NyloSplits,
  NyloWaveSpawnEvent,
  PersonalBestType,
  PlayerAttack,
  PlayerAttackEvent,
  PlayerDeathEvent,
  PlayerInfo,
  PlayerUpdateEvent,
  PrimaryMeleeGear,
  RaidStatus,
  RecordedRaidModel,
  RecordingType,
  Room,
  RoomNpc,
  RoomNpcType,
  RoomStatus,
  RoomStatusEvent,
  SoteMazeProcEvent,
  SoteSplits,
  VerzikAttackStyle,
  VerzikAttackStyleEvent,
  VerzikCrab,
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
import { NyloWaveStallEvent } from '@blert/common';

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

function roomResetStatus(room: Room): RaidStatus {
  switch (room) {
    case Room.MAIDEN:
      return RaidStatus.MAIDEN_RESET;
    case Room.BLOAT:
      return RaidStatus.BLOAT_RESET;
    case Room.NYLOCAS:
      return RaidStatus.NYLO_RESET;
    case Room.SOTETSEG:
      return RaidStatus.SOTE_RESET;
    case Room.XARPUS:
      return RaidStatus.XARPUS_RESET;
    case Room.VERZIK:
      return RaidStatus.COMPLETED;
  }
}

function roomWipeStatus(room: Room): RaidStatus {
  switch (room) {
    case Room.MAIDEN:
      return RaidStatus.MAIDEN_WIPE;
    case Room.BLOAT:
      return RaidStatus.BLOAT_WIPE;
    case Room.NYLOCAS:
      return RaidStatus.NYLO_WIPE;
    case Room.SOTETSEG:
      return RaidStatus.SOTE_WIPE;
    case Room.XARPUS:
      return RaidStatus.XARPUS_WIPE;
    case Room.VERZIK:
      return RaidStatus.VERZIK_WIPE;
  }
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
  private mode: Mode | null;
  private party: string[];
  private partyInfo: PlayerInfo[];
  private startTime: number;
  private raidStatus: RaidStatus;
  private completedRooms: number;
  private totalRoomTicks: number;
  private overallTicks: number;

  private playerInfoUpdated: Set<string>;

  private room: Room;
  private roomStatus: RoomStatus;
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
  private verzikRedSpawns: number;

  public constructor(
    id: string,
    party: string[],
    mode: Mode | null,
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
    this.raidStatus = RaidStatus.IN_PROGRESS;
    this.completedRooms = 0;
    this.totalRoomTicks = 0;
    this.overallTicks = 0;

    this.playerInfoUpdated = new Set();

    this.room = Room.MAIDEN;
    this.roomStatus = RoomStatus.ENTERED;
    this.roomTick = 0;
    this.roomEvents = [];
    this.deathsInRoom = [];
    this.queuedPbUpdates = [];

    this.maidenSplits = {
      [MaidenCrabSpawn.SEVENTIES]: 0,
      [MaidenCrabSpawn.FIFTIES]: 0,
      [MaidenCrabSpawn.THIRTIES]: 0,
    };
    this.bloatSplits = { downTicks: [] };
    this.nyloSplits = { capIncrease: 0, waves: 0, cleanup: 0, boss: 0 };
    this.soteSplits = { [Maze.MAZE_66]: 0, [Maze.MAZE_33]: 0 };
    this.xarpusSplits = { exhumes: 0, screech: 0 };
    this.verzikSplits = { p1: 0, reds: 0, p2: 0 };

    this.npcs = new Map();
    this.stalledNyloWaves = [];
    this.verzikRedSpawns = 0;
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

  public async setMode(mode: Mode): Promise<void> {
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
      status: this.raidStatus,
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
        record.status = this.raidStatus;
      }),
    );

    if (this.raidStatus === RaidStatus.COMPLETED && this.completedRooms === 6) {
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
          switch (this.raidStatus) {
            case RaidStatus.COMPLETED:
              stats.completions += 1;
              break;

            case RaidStatus.MAIDEN_RESET:
            case RaidStatus.BLOAT_RESET:
            case RaidStatus.NYLO_RESET:
            case RaidStatus.SOTE_RESET:
            case RaidStatus.XARPUS_RESET:
              stats.resets += 1;
              break;

            case RaidStatus.MAIDEN_WIPE:
            case RaidStatus.BLOAT_WIPE:
            case RaidStatus.NYLO_WIPE:
            case RaidStatus.SOTE_WIPE:
            case RaidStatus.XARPUS_WIPE:
            case RaidStatus.VERZIK_WIPE:
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
      case EventType.ROOM_STATUS:
        await this.handleRoomStatusUpdate(event as RoomStatusEvent);
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

  private async handleRoomStatusUpdate(event: RoomStatusEvent): Promise<void> {
    if (!event.room) {
      return;
    }

    switch (event.roomStatus.status) {
      case RoomStatus.STARTED:
        if (this.state === State.STARTING) {
          await this.start();
        }
        if (this.roomStatus === RoomStatus.ENTERED) {
          // A transition from ENTERED -> STARTED has already reset the room.
          // Don't clear any data received afterwards, unless the room is new.
          if (this.room === event.room) {
            break;
          }
        }
      // A transition from any other state to STARTED should fall through
      // and reset all room data.
      case RoomStatus.ENTERED:
        this.room = event.room;
        this.roomEvents = [];
        this.roomTick = 0;
        this.deathsInRoom = [];
        this.queuedPbUpdates = [];
        this.npcs.clear();
        break;

      case RoomStatus.WIPED:
      case RoomStatus.COMPLETED:
        if (event.room === this.room) {
          this.handleRoomFinished(event);
        } else {
          console.error(
            `Raid ${this.id} got status ${event.roomStatus} for room ${event.room} but is in room ${this.room}`,
          );
        }
        break;
    }

    this.roomStatus = event.roomStatus.status;
  }

  private async handleRoomFinished(event: RoomStatusEvent): Promise<void> {
    // Set the appropriate status if the raid were to be finished at this
    // point.
    this.raidStatus =
      event.roomStatus.status === RoomStatus.WIPED
        ? roomWipeStatus(this.room)
        : roomResetStatus(this.room);
    this.completedRooms++;
    this.totalRoomTicks += event.tick;

    const promises = [];

    let firstTick = 0;
    if (!event.roomStatus.accurate) {
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
            record.rooms[Room.VERZIK].redCrabSpawns = this.verzikRedSpawns;
            break;
        }
      }),
      this.flushRoomEvents(),
    );

    if (event.roomStatus.accurate) {
      // Only update personal bests if the room timer is accurate.
      this.queuedPbUpdates.forEach((update) => {
        promises.push(this.updatePartyPbs(update.pbType, update.pbTime));
      });

      if (event.roomStatus.status === RoomStatus.COMPLETED) {
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

      case EventType.BLOAT_DOWN:
        this.bloatSplits.downTicks.push(event.tick);
        break;

      case EventType.NYLO_WAVE_SPAWN:
        const nyloWaveSpawnEvent = event as NyloWaveSpawnEvent;
        if (nyloWaveSpawnEvent.nyloWave.wave === 20) {
          this.nyloSplits.capIncrease = event.tick;
        } else if (nyloWaveSpawnEvent.nyloWave.wave === 31) {
          this.nyloSplits.waves = event.tick;
        }
        break;

      case EventType.NYLO_WAVE_STALL:
        const nyloWaveStallEvent = event as NyloWaveStallEvent;
        this.stalledNyloWaves.push(nyloWaveStallEvent.nyloWave.wave);
        break;

      case EventType.NYLO_CLEANUP_END:
        this.nyloSplits.cleanup = event.tick;
        break;

      case EventType.NYLO_BOSS_SPAWN:
        this.nyloSplits.boss = event.tick;
        this.queuedPbUpdates.push({
          pbType: PersonalBestType.TOB_NYLO_BOSS,
          pbTime: event.tick,
        });
        break;

      case EventType.SOTE_MAZE_PROC:
        const mazeProcEvent = event as SoteMazeProcEvent;
        this.soteSplits[mazeProcEvent.soteMaze.maze] = event.tick;
        break;

      case EventType.XARPUS_PHASE:
        const xarpusPhaseEvent = event as XarpusPhaseEvent;
        if (xarpusPhaseEvent.xarpusPhase === XarpusPhase.P2) {
          this.xarpusSplits.exhumes = event.tick;
        } else if (xarpusPhaseEvent.xarpusPhase === XarpusPhase.P3) {
          this.xarpusSplits.screech = event.tick;
        }
        break;

      case EventType.VERZIK_PHASE:
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

      case EventType.VERZIK_REDS_SPAWN:
        this.verzikRedSpawns++;
        if (this.verzikRedSpawns == 1) {
          // First red spawn is recorded as a room split.
          this.verzikSplits.reds = event.tick;
        }
        break;

      case EventType.VERZIK_ATTACK_STYLE:
        // Update the previously-written NPC_ATTACK event.
        const verzikAttackStyle = event as VerzikAttackStyleEvent;

        const record = await RoomEvent.findOne({
          raidId: this.id,
          type: EventType.NPC_ATTACK,
          tick: verzikAttackStyle.verzikAttack.npcAttackTick,
          room: Room.VERZIK,
          'npcAttack.attack': NpcAttack.VERZIK_P3_AUTO,
        });

        if (record !== null) {
          switch (verzikAttackStyle.verzikAttack.style) {
            case VerzikAttackStyle.MELEE:
              record.npcAttack.attack = NpcAttack.VERZIK_P3_MELEE;
              break;
            case VerzikAttackStyle.RANGE:
              record.npcAttack.attack = NpcAttack.VERZIK_P3_RANGE;
              break;
            case VerzikAttackStyle.MAGE:
              record.npcAttack.attack = NpcAttack.VERZIK_P3_MAGE;
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

    if (event.npc.maidenCrab !== undefined) {
      const spawn = event.npc.maidenCrab.spawn;
      if (this.maidenSplits[spawn] == 0) {
        this.maidenSplits[spawn] = event.tick;
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
}
