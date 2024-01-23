import {
  Event,
  EventType,
  Mode,
  RaidStatus,
  Room,
  RoomStatus,
  RoomStatusEvent,
} from '@blert/common';

import Client from './client';

export function raidPartyKey(partyMembers: string[]) {
  return partyMembers
    .map((name) => name.toLowerCase().replace(' ', '_'))
    .join('-');
}

enum State {
  STARTING,
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
  private room: Room;
  private raidStatus: RaidStatus;

  private eventsForRoom: { [room in Room]?: Event[] };

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
    this.room = Room.MAIDEN;
    this.raidStatus = RaidStatus.IN_PROGRESS;

    this.eventsForRoom = {};
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

  public setMode(mode: Mode) {
    this.mode = mode;
  }

  public hasClients(): boolean {
    return this.clients.length > 0;
  }

  public finish(): void {}

  public processEvent(event: Event): void {
    switch (event.type) {
      case EventType.ROOM_STATUS:
        this.handleRoomStatusUpdate(event as RoomStatusEvent);
        break;
      default:
        this.eventsForRoom[this.room]?.push(event);
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

  private handleRoomStatusUpdate(event: RoomStatusEvent): void {
    if (!event.room) {
      return;
    }

    switch (event.roomStatus) {
      case RoomStatus.STARTED:
        this.room = event.room;
        this.eventsForRoom[this.room] = [];
        break;

      case RoomStatus.WIPED:
      case RoomStatus.COMPLETED:
        // Set the appropriate status if the raid were to be finished at this
        // point.
        this.raidStatus =
          event.roomStatus === RoomStatus.WIPED
            ? roomWipeStatus(event.room)
            : roomResetStatus(event.room);

        if (this.eventsForRoom[this.room]) {
          delete this.eventsForRoom[this.room];
        }
        break;
    }
  }
}
