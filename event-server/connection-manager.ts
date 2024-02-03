import Client from './client';

export default class ConnectionManager {
  private activeClients: { [id: number]: Client };
  private nextSessionId;

  public constructor() {
    this.activeClients = {};
    this.nextSessionId = 1;
  }

  /**
   * Checks whether an API key is valid.
   *
   * @param token The API key.
   * @returns ID of the user to which the key belongs.
   * @throws Error if the key is invalid.
   */
  public async authenticate(token: string): Promise<number> {
    // TODO(frolv): When accounts are added, check the token against the
    // database and return the actual ID of the account;
    if (token !== process.env.BLERT_DEVELOPMENT_API_KEY) {
      throw { message: 'Invalid token' };
    }

    const userId = 123;
    return userId;
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
