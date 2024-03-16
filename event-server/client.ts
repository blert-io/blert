import { WebSocket } from 'ws';

import MessageHandler from './message-handler';
import Raid from './raid';
import { ServerMessage, ServerMessageType } from './server-message';
import { BasicUser } from './users';

export default class Client {
  private static HEARTBEAT_INTERVAL_MS: number = 5000;

  private user: BasicUser;
  private sessionId: number;
  private socket: WebSocket;
  private messageHandler: MessageHandler;
  private activeRaid: Raid | null;
  private messages: ServerMessage[];

  private closeCallbacks: (() => void)[];

  private lastHeartbeatTime: number;

  constructor(
    socket: WebSocket,
    eventHandler: MessageHandler,
    user: BasicUser,
  ) {
    this.user = user;
    this.sessionId = -1;
    this.socket = socket;
    this.messageHandler = eventHandler;
    this.activeRaid = null;
    this.closeCallbacks = [];
    this.messages = [];
    this.lastHeartbeatTime = Date.now();

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
    socket.on('message', (message) => {
      this.messages.push(JSON.parse(message.toString()));
    });

    setTimeout(() => this.processMessages(), 20);
    setTimeout(() => this.heartbeat(), Client.HEARTBEAT_INTERVAL_MS);
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

  public getActiveRaid(): Raid | null {
    return this.activeRaid;
  }

  public setActiveRaid(raid: Raid | null): void {
    this.activeRaid = raid;
  }

  public sendMessage(message: ServerMessage): void {
    const payload = JSON.stringify(message);
    this.socket.send(payload);
  }

  public close(): void {
    this.socket.close();
  }

  public onClose(callback: () => void): void {
    this.closeCallbacks.push(callback);
  }

  private async processMessages(): Promise<void> {
    if (this.messages.length > 0) {
      const message = this.messages.shift()!;

      if (message.type === ServerMessageType.HEARTBEAT_PONG) {
        this.lastHeartbeatTime = Date.now();
      } else {
        await this.messageHandler.handleMessage(this, message);
      }
    }

    // Keep running forever.
    setTimeout(() => this.processMessages(), 20);
  }

  private async heartbeat(): Promise<void> {
    this.sendMessage({ type: ServerMessageType.HEARTBEAT_PING });
    // Keep running forever.
    setTimeout(() => this.heartbeat(), Client.HEARTBEAT_INTERVAL_MS);
  }

  private cleanup(): void {
    if (this.activeRaid !== null) {
      this.activeRaid.removeClient(this);
      this.activeRaid = null;
    }

    this.closeCallbacks.forEach((callback) => {
      callback();
    });

    this.sessionId = -1;
    this.closeCallbacks = [];
  }
}
