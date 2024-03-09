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

  private playerInfoUpdated: Set<string>;

  private room: Room;
  private roomStatus: RoomStatus;
  private roomTick: number;
  private roomEvents: Event[];
  private deathsInRoom: string[];

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

    this.playerInfoUpdated = new Set();

    this.room = Room.MAIDEN;
    this.roomStatus = RoomStatus.ENTERED;
    this.roomTick = 0;
    this.roomEvents = [];
    this.deathsInRoom = [];

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

  public async setMode(mode: Mode): Promise<void> {
    this.mode = mode;
    await this.updateDatabaseFields((record) => {
      record.mode = this.mode;
    });
  }

  public hasClients(): boolean {
    return this.clients.length > 0;
  }

  public async start(): Promise<void> {
    this.state = State.IN_PROGRESS;

    const documentsToCreate: Promise<any>[] = [];

    const record = new RaidModel({
      _id: this.id,
      mode: this.mode,
      status: this.raidStatus,
      startTime: this.startTime,
      party: this.party,
      partyInfo: this.partyInfo,
      totalRoomTicks: 0,
    });
    documentsToCreate.push(record.save());

    for (const username of this.party) {
      documentsToCreate.push(Players.startNewRaid(username));
    }

    await Promise.all(documentsToCreate);
  }

  public async finish(): Promise<void> {
    let promises: Promise<void>[] = [];

    promises.push(
      this.updateDatabaseFields((record) => {
        record.status = this.raidStatus;
      }),
    );

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

  private async handleRoomStatusUpdate(event: RoomStatusEvent): Promise<void> {
    if (!event.room) {
      return;
    }

    switch (event.roomStatus) {
      case RoomStatus.STARTED:
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
        this.npcs.clear();
        break;

      case RoomStatus.WIPED:
      case RoomStatus.COMPLETED:
        // Set the appropriate status if the raid were to be finished at this
        // point.
        this.raidStatus =
          event.roomStatus === RoomStatus.WIPED
            ? roomWipeStatus(event.room)
            : roomResetStatus(event.room);

        await Promise.all([
          this.updateDatabaseFields((record) => {
            record.partyInfo = this.partyInfo;
            record.totalRoomTicks += event.tick;
            record.totalDeaths += this.deathsInRoom.length;
            record.rooms[event.room!] = {
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
        ]);

        break;
    }

    this.roomStatus = event.roomStatus;
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
        } else if (verzikPhaseEvent.verzikPhase === VerzikPhase.P3) {
          this.verzikSplits.p2 = event.tick;
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
        await Players.updateStats(username, (stats) => {
          stats.bgsSmacks += 1;
        });
        break;

      case PlayerAttack.CHIN_BLACK:
      case PlayerAttack.CHIN_GREY:
      case PlayerAttack.CHIN_RED:
        let chinPrice: number;
        try {
          chinPrice = await priceTracker.getPrice(attack.weapon.id);
        } catch (e) {
          chinPrice = 0;
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

      case PlayerAttack.HAMMER_BOP:
        await Players.updateStats(username, (stats) => {
          stats.hammerBops += 1;
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

  private async updateDatabaseFields(updateCallback: (document: any) => void) {
    const record = await RaidModel.findOne({ _id: this.id });
    if (record !== null) {
      updateCallback(record);
      record.save();
    }
  }

  private async flushRoomEvents(): Promise<void> {
    if (this.roomEvents.length > 0) {
      RoomEvent.insertMany(this.roomEvents);
    }
    this.roomEvents = [];
  }
}
