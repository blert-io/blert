import {
  Event,
  EventType,
  Mode,
  RaidStatus,
  Room,
  RoomStatus,
  RoomStatusEvent,
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
  private roomTick: number;
  private roomEvents: Event[];

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
    this.roomTick = 0;
    this.roomEvents = [];
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

        // Batch and flush events once per tick to reduce database writes.
        if (event.tick == this.roomTick) {
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
        this.room = event.room;
        this.roomEvents = [];
        this.roomTick = 0;
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
            record.rooms[event.room!] = { roomTicks: event.tick };
          }),
          this.flushRoomEvents(),
        ]);

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

  private async flushRoomEvents(): Promise<void> {
    if (this.roomEvents.length > 0) {
      RoomEvent.insertMany(this.roomEvents);
    }
    this.roomEvents = [];
  }
}
