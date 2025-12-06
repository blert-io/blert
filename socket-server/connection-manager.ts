import { ServerMessage } from '@blert/common/generated/server_message_pb';

import Client from './client';
import { BasicUser, Users } from './users';
import { recordActiveClients, recordClientRegistration } from './metrics';

export default class ConnectionManager {
  private activeClients: Map<number, Client>;
  private nextSessionId;

  public constructor() {
    this.activeClients = new Map();
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
    const user = await Users.findByApiKey(token);
    if (user === null) {
      throw new Error('Invalid API key');
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

    this.activeClients.set(sessionId, client);

    const pluginInfo = client.getPluginVersions();
    recordClientRegistration({
      pluginVersion: pluginInfo.getVersion(),
      runeLiteVersion: pluginInfo.getRuneLiteVersion(),
    });
    recordActiveClients(this.activeClients.size);

    const connectionResponse = new ServerMessage();
    connectionResponse.setType(ServerMessage.Type.CONNECTION_RESPONSE);
    const user = new ServerMessage.User();
    user.setId(client.getUserId());
    user.setName(client.getUsername());
    connectionResponse.setUser(user);

    client.sendMessage(connectionResponse);
  }

  public removeClient(client: Client) {
    this.activeClients.delete(client.getSessionId());
    recordActiveClients(this.activeClients.size);
  }

  public closeAllClients() {
    const clients = Array.from(this.activeClients.values());
    for (const client of clients) {
      // Client's onClose callback handles removing the client from the map.
      client.close(1001);
    }
    recordActiveClients(0);
  }

  public clients(): readonly Client[] {
    return Array.from(this.activeClients.values());
  }

  private newSessionId(): number {
    // 2**53 session IDs ought to be enough for anybody.
    return this.nextSessionId++;
  }
}
