import {
  BloatSplits,
  Event,
  EventType,
  MaidenCrab,
  MaidenCrabSpawn,
  MaidenSplits,
  Maze,
  Mode,
  NpcDeathEvent,
  NpcSpawnEvent,
  Nylo,
  NyloSplits,
  NyloWaveSpawnEvent,
  PlayerDeathEvent,
  RaidStatus,
  Room,
  RoomNpc,
  RoomNpcType,
  RoomStatus,
  RoomStatusEvent,
  SoteMazeProcEvent,
  SoteSplits,
  VerzikPhase,
  VerzikPhaseEvent,
  VerzikRedsSpawnEvent,
  VerzikSplits,
  XarpusPhase,
  XarpusPhaseEvent,
  XarpusSplits,
} from '@blert/common';
import { RaidModel, RoomEvent } from '@blert/common';

import Client from './client';

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

export default class Raid {
  private id: string;
  private partyKey: string;
  private clients: Client[];

  private state: State;
  private mode: Mode | null;
  private party: string[];
  private startTime: number;
  private raidStatus: RaidStatus;

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
    this.startTime = startTime;
    this.raidStatus = RaidStatus.IN_PROGRESS;

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

    const record = new RaidModel({
      _id: this.id,
      mode: this.mode,
      status: this.raidStatus,
      startTime: this.startTime,
      party: this.party,
    });
    await record.save();
  }

  public async finish(): Promise<void> {
    await this.updateDatabaseFields((record) => {
      record.status = this.raidStatus;
    });
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

        await this.updateRaidStatus(event);

        // Batch and flush events once per tick to reduce database writes.
        if (event.tick === this.roomTick) {
          this.roomEvents.push(event);
        } else if (event.tick > this.roomTick) {
          await this.flushRoomEvents();
          this.roomEvents.push(event);
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
   * @returns `true` if the client was added, `false` if not.
   */
  public registerClient(client: Client): boolean {
    if (client.getActiveRaid() !== null) {
      console.error(
        `Client ${client.getSessionId()} attempted to join raid ${this.id}, but is already in a raid`,
      );
      return false;
    }

    if (this.clients.find((c) => c == client) === undefined) {
      this.clients.push(client);
      client.setActiveRaid(this);
      return true;
    }

    return false;
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
          // Don't clear any data received afterwards.
          break;
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

  private async updateRaidStatus(event: Event): Promise<void> {
    switch (event.type) {
      case EventType.PLAYER_DEATH:
        this.deathsInRoom.push((event as PlayerDeathEvent).player.name);
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
    } else {
      this.npcs.set(event.npc.roomId.toString(), npcCommon);
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
