import {
  NAME_CHANGE_PUBSUB_KEY,
  NameChangeUpdate,
  NameChangeUpdateType,
} from '@blert/common';
import { ServerMessage } from '@blert/common/generated/server_message_pb';
import { RedisClientType } from 'redis';

import { ActionDefinitionsRepository } from './action-definitions';
import Client, { Session } from './client';
import logger from './log';
import { recordActiveClients, recordClientRegistration } from './metrics';
import { BasicUser, Users } from './users';

export default class ConnectionManager {
  private activeClients: Map<number, Client>;
  private nextSessionId;
  private pubsubClient: RedisClientType | null;
  private definitionsRepository: ActionDefinitionsRepository;

  public constructor(
    redisClient: RedisClientType | null,
    definitionsRepository: ActionDefinitionsRepository,
  ) {
    this.activeClients = new Map();
    this.nextSessionId = 1;
    this.pubsubClient = null;
    this.definitionsRepository = definitionsRepository;

    if (redisClient !== null) {
      this.pubsubClient = redisClient.duplicate() as RedisClientType;
      this.pubsubClient.on('error', (e) => {
        logger.error('redis_error', {
          key: NAME_CHANGE_PUBSUB_KEY,
          message: e instanceof Error ? e.message : String(e),
        });
      });
      void this.startPubsub();
    }
  }

  private async startPubsub(): Promise<void> {
    if (this.pubsubClient === null) {
      return;
    }

    await this.pubsubClient.connect();

    await this.pubsubClient.subscribe(
      NAME_CHANGE_PUBSUB_KEY,
      this.handleNameChangeUpdate.bind(this),
    );

    logger.debug('connection_manager_pubsub_started');
  }

  private handleNameChangeUpdate(message: string): void {
    let update: NameChangeUpdate;
    try {
      update = JSON.parse(message) as NameChangeUpdate;
    } catch (e) {
      logger.error('name_change_update_parse_error', {
        key: NAME_CHANGE_PUBSUB_KEY,
        message: e instanceof Error ? e.message : String(e),
      });
      return;
    }

    if (update.type === NameChangeUpdateType.MERGED) {
      const { deletedPlayerId, remainingPlayerId, oldName, newName } = update;

      for (const client of this.activeClients.values()) {
        if (client.getLinkedPlayerId() === deletedPlayerId) {
          logger.info('client_player_id_updated', {
            sessionId: client.getSessionId(),
            userId: client.getUserId(),
            oldPlayerId: deletedPlayerId,
            newPlayerId: remainingPlayerId,
            oldName,
            newName,
          });
          client.setLinkedPlayerId(remainingPlayerId);
        }
      }
    }
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
    const session = this.newSession();
    client.setSession(session);
    client.onClose(() => this.removeClient(client));

    this.activeClients.set(session.id, client);

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

    // Send the latest action definitions on connection.
    client.sendMessage(
      this.definitionsRepository.createAttackDefinitionsMessage(),
    );
    client.sendMessage(
      this.definitionsRepository.createSpellDefinitionsMessage(),
    );

    client.startGameStateRequestCycle();
  }

  public removeClient(client: Client) {
    this.activeClients.delete(client.getSessionId());
    recordActiveClients(this.activeClients.size);
  }

  /**
   * Closes every connected client and resolves once their closing handshakes
   * have completed, forcibly terminating any that has not finished closing
   * within `timeoutMs`.
   */
  public async closeAllClients(timeoutMs: number = 5000): Promise<void> {
    const clients = Array.from(this.activeClients.values());
    if (clients.length === 0) {
      return;
    }

    const allClosed = new Promise<void>((resolve) => {
      let remaining = clients.length;
      for (const client of clients) {
        // The onClose callback removes the client from the map.
        client.onClose(() => {
          if (--remaining === 0) {
            resolve();
          }
        });
        client.close(1001);
      }
    });

    let handshakeTimer: NodeJS.Timeout | undefined;
    await Promise.race([
      allClosed,
      new Promise<void>((resolve) => {
        handshakeTimer = setTimeout(resolve, timeoutMs);
      }),
    ]);
    clearTimeout(handshakeTimer);

    // Force-close any client that did not complete its closing handshake, then
    // wait for the resulting close handlers to run so each disconnect is
    // propagated.
    const stragglers = Array.from(this.activeClients.values());
    if (stragglers.length > 0) {
      for (const client of stragglers) {
        client.terminate();
      }
      await allClosed;
    }

    recordActiveClients(this.activeClients.size);
  }

  public clients(): readonly Client[] {
    return Array.from(this.activeClients.values());
  }

  private newSession(): Session {
    return {
      // 2**53 session IDs ought to be enough for anybody.
      id: this.nextSessionId++,
      token: crypto.randomUUID(),
    };
  }
}
