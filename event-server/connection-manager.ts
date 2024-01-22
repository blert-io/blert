import Client from './client';

export default class ConnectionManager {
  private activeClients: { [id: number]: Client };
  private nextSessionId;

  public constructor() {
    this.activeClients = {};
    this.nextSessionId = 1;
  }

  /**
   * Registers a new client connection.
   * @param client The connected client.
   */
  public addClient(client: Client) {
    const sessionId = this.newSessionId();
    client.setSessionId(sessionId);
    client.onClose(() => this.removeClient(client));

    this.activeClients[sessionId] = client;
  }

  public removeClient(client: Client) {
    delete this.activeClients[client.getSessionId()];
  }

  private newSessionId(): number {
    // 2**53 session IDs ought to be sufficient.
    return this.nextSessionId++;
  }
}
