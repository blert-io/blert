import Client from './client';
import { ConnectionResponseMessage, ServerMessageType } from './server-message';
import { BasicUser, Users } from './users';

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
  public async authenticate(token: string): Promise<BasicUser> {
    // TODO(frolv): When accounts are added, check the token against the
    // database and return the actual ID of the account;
    const user = await Users.findByApiKey(token);

    if (user === null) {
      throw { message: 'Invalid token' };
    }

    return user;
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

    const connectionResponse: ConnectionResponseMessage = {
      type: ServerMessageType.CONNECTION_RESPONSE,
      user: {
        id: client.getUserId(),
        name: client.getUsername(),
      },
    };
    client.sendMessage(connectionResponse);
  }

  public removeClient(client: Client) {
    delete this.activeClients[client.getSessionId()];
  }

  private newSessionId(): number {
    // 2**53 session IDs ought to be sufficient.
    return this.nextSessionId++;
  }
}
