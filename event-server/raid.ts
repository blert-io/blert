import Client from './client';

export function raidPartyKey(partyMembers: string[]) {
  return partyMembers
    .map((name) => name.toLowerCase().replace(' ', '_'))
    .join('-');
}

export default class Raid {
  private id: string;
  private partyKey: string;
  private party: string[];
  private clients: Client[];

  public constructor(id: string, party: string[]) {
    this.id = id;
    this.partyKey = raidPartyKey(party);
    this.party = party;
    this.clients = [];
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

  public hasClients(): boolean {
    return this.clients.length > 0;
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
}
