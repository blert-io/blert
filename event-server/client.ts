import { ServerMessage } from '@blert/common/generated/server_message_pb';
import { WebSocket } from 'ws';

import { Challenge } from './challenge';
import MessageHandler from './message-handler';
import { BasicUser } from './users';

type Stats = {
  total: number;
  maxSize: number;
  meanSize: number;
};

class MessageStats {
  public in: Stats;
  public out: Stats;

  constructor() {
    this.in = { total: 0, maxSize: 0, meanSize: 0 };
    this.out = { total: 0, maxSize: 0, meanSize: 0 };
  }

  public recordIn(size: number): void {
    this.updateStats(this.in, size);
  }

  public recordOut(size: number): void {
    this.updateStats(this.out, size);
  }

  public logString(): string {
    return (
      `in=${this.in.total} max(size)=${this.in.maxSize} mean(size)=${this.in.meanSize | 0} | ` +
      `out=${this.out.total} max(size)=${this.out.maxSize} mean(size)=${this.out.meanSize | 0}`
    );
  }

  private updateStats(stats: Stats, size: number) {
    stats.total++;
    stats.maxSize = Math.max(stats.maxSize, size);
    stats.meanSize = (stats.meanSize * (stats.total - 1) + size) / stats.total;
  }
}

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

  private lastMessageLog: number;
  private stats: MessageStats;

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
    this.stats = new MessageStats();

    this.loggedInRsn = null;

    socket.binaryType = 'arraybuffer';

    socket.on('close', (code) => {
      console.log(`${this} closed: ${code}`);
      this.cleanup();
    });
    socket.on('error', (code) => {
      console.log(`${this} error: ${code}`);
      this.cleanup();
    });

    // Messages received through the socket are pushed into a message queue
    // where they are processed synchronously through `processMessages`.
    socket.on('message', (message: ArrayBuffer, isBinary) => {
      if (isBinary) {
        this.stats.recordIn(message.byteLength);

        const now = Date.now();
        if (now - this.lastMessageLog > 60 * 1000) {
          console.log(`${this}: ${this.stats.logString()}`);
          this.lastMessageLog = now;
        }

        try {
          const serverMessage = ServerMessage.deserializeBinary(
            new Uint8Array(message),
          );
          this.messageQueue.push(serverMessage);
        } catch (e) {
          console.log(`${this} received invalid protobuf message: ${e}`);
        }
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
  public getUserId(): number {
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
  public getLinkedPlayerId(): number {
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
      const serialized = message.serializeBinary();
      this.stats.recordOut(serialized.length);
      this.socket.send(serialized);
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
