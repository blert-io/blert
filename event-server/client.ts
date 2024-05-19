import { ServerMessage } from '@blert/common/generated/server_message_pb';
import { Types } from 'mongoose';
import { WebSocket } from 'ws';

import { Challenge } from './challenge';
import MessageHandler from './message-handler';
import { BasicUser } from './users';

export default class Client {
  private static HEARTBEAT_INTERVAL_MS: number = 5000;
  private static HEARTBEAT_DISCONNECT_THRESHOLD: number = 6;

  private user: BasicUser;
  private sessionId: number;
  private socket: WebSocket;
  private messageHandler: MessageHandler;
  private activeChallenge: Challenge | null;
  private messageQueue: ServerMessage[];
  private isOpen: boolean;

  private closeCallbacks: (() => void)[];

  private heartbeatAcknowledged: boolean;
  private missedHeartbeats: number;

  private processTimeout: NodeJS.Timeout;
  private heartbeatTimeout: NodeJS.Timeout;

  // TODO(frolv): Temporary, for debugging purposes.
  private lastMessageLog: number;
  private totalMessages: number;
  private maxMessageSize: number;
  private meanMessageSize: number;

  private loggedInRsn: string | null;

  constructor(
    socket: WebSocket,
    eventHandler: MessageHandler,
    user: BasicUser,
  ) {
    this.user = user;
    this.sessionId = -1;
    this.socket = socket;
    this.messageHandler = eventHandler;
    this.activeChallenge = null;
    this.closeCallbacks = [];
    this.messageQueue = [];
    this.isOpen = true;

    this.heartbeatAcknowledged = true;
    this.missedHeartbeats = 0;

    this.lastMessageLog = Date.now();
    this.totalMessages = 0;
    this.maxMessageSize = 0;
    this.meanMessageSize = 0;

    this.loggedInRsn = null;

    socket.binaryType = 'arraybuffer';

    socket.on('close', (code) => {
      console.log(`Client ${this.sessionId} closed: ${code}`);
      this.cleanup();
    });
    socket.on('error', (code) => {
      console.log(`Client ${this.sessionId} error: ${code}`);
      this.cleanup();
    });

    // Messages received through the socket are pushed into a message queue
    // where they are processed synchronously through `processMessages`.
    socket.on('message', (message: ArrayBuffer, isBinary) => {
      if (isBinary) {
        this.totalMessages++;
        this.maxMessageSize = Math.max(this.maxMessageSize, message.byteLength);
        this.meanMessageSize =
          (this.meanMessageSize * (this.totalMessages - 1) +
            message.byteLength) /
          this.totalMessages;

        const now = Date.now();
        if (now - this.lastMessageLog > 60 * 1000) {
          console.log(
            `${this}: messages=${this.totalMessages} max(size)=${this.maxMessageSize} mean(size)=${this.meanMessageSize | 0}`,
          );
          this.lastMessageLog = now;
        }

        const serverMessage = ServerMessage.deserializeBinary(
          new Uint8Array(message),
        );
        this.messageQueue.push(serverMessage);
      } else {
        console.log(`${this} received unsupported text message`);
      }
    });

    this.processTimeout = setTimeout(() => this.processMessages(), 20);
    this.heartbeatTimeout = setTimeout(
      () => this.heartbeat(),
      Client.HEARTBEAT_INTERVAL_MS,
    );
  }

  /**
   * Returns the client's session ID.
   * @returns The session ID.
   */
  public getSessionId(): number {
    return this.sessionId;
  }

  public setSessionId(sessionId: number): void {
    this.sessionId = sessionId;
  }

  /**
   * Returns the client's user ID.
   * @returns The user ID.
   */
  public getUserId(): string {
    return this.user.id;
  }

  /**
   * Returns the username of this client's user.
   * @returns The user's name.
   */
  public getUsername(): string {
    return this.user.username;
  }

  /**
   * Returns ID of the Blert player linked to this client's API key.
   * @returns Player ID.
   */
  public getLinkedPlayerId(): Types.ObjectId {
    return this.user.linkedPlayerId;
  }

  public getActiveChallenge(): Challenge | null {
    return this.activeChallenge;
  }

  public setActiveChallenge(challenge: Challenge | null): void {
    console.log(
      `${this}: active challenge set to ${challenge ? challenge.getId() : 'null'}`,
    );
    this.activeChallenge = challenge;
  }

  public getLoggedInRsn(): string | null {
    return this.loggedInRsn;
  }

  public setLoggedInRsn(rsn: string | null): void {
    this.loggedInRsn = rsn;
  }

  public sendMessage(message: ServerMessage): void {
    if (this.isOpen) {
      this.socket.send(message.serializeBinary());
    }
  }

  public sendUnauthenticatedAndClose(): void {
    if (!this.isOpen) {
      return;
    }

    const message = new ServerMessage();
    message.setType(ServerMessage.Type.ERROR);
    const error = new ServerMessage.Error();
    error.setType(ServerMessage.Error.Type.UNAUTHENTICATED);
    message.setError(error);
    this.sendMessage(message);

    setTimeout(() => this.close(), 1000);
  }

  public close(code?: number): void {
    this.socket.close(code ?? 1000);
  }

  public onClose(callback: () => void): void {
    this.closeCallbacks.push(callback);
  }

  public toString(): string {
    return `Client#${this.sessionId}[${this.user.username}]`;
  }

  private async processMessages(): Promise<void> {
    if (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift()!;

      if (message.getType() === ServerMessage.Type.PONG) {
        this.heartbeatAcknowledged = true;
        this.missedHeartbeats = 0;
      } else {
        await this.messageHandler.handleMessage(this, message);
      }
    }

    // Keep running forever.
    if (this.isOpen) {
      this.processTimeout = setTimeout(() => this.processMessages(), 20);
    }
  }

  private async heartbeat(): Promise<void> {
    const ping = new ServerMessage();
    ping.setType(ServerMessage.Type.PING);
    this.sendMessage(ping);

    if (!this.heartbeatAcknowledged) {
      this.missedHeartbeats++;

      if (this.missedHeartbeats >= Client.HEARTBEAT_DISCONNECT_THRESHOLD) {
        console.log(`${this} is unresponsive, closing connection`);
        this.isOpen = false;
        this.close();
        return;
      }
    }

    this.heartbeatAcknowledged = false;

    // Keep running forever.
    if (this.isOpen) {
      this.heartbeatTimeout = setTimeout(
        () => this.heartbeat(),
        Client.HEARTBEAT_INTERVAL_MS,
      );
    }
  }

  private cleanup(): void {
    this.isOpen = false;

    clearTimeout(this.processTimeout);
    clearTimeout(this.heartbeatTimeout);

    this.closeCallbacks.forEach((callback) => {
      callback();
    });

    this.messageHandler.closeClient(this);

    this.sessionId = -1;
    this.closeCallbacks = [];
    this.activeChallenge = null;
  }
}
