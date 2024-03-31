import { ServerMessage } from '@blert/common/generated/server_message_pb';
import { WebSocket } from 'ws';

import MessageHandler from './message-handler';
import { BasicUser } from './users';
import { Challenge } from './challenge';

export default class Client {
  private static HEARTBEAT_INTERVAL_MS: number = 5000;

  private user: BasicUser;
  private sessionId: number;
  private socket: WebSocket;
  private messageHandler: MessageHandler;
  private activeChallenge: Challenge | null;
  private messageQueue: ServerMessage[];

  private closeCallbacks: (() => void)[];

  private lastHeartbeatTime: number;

  // TODO(frolv): Temporary, for debugging purposes.
  private lastMessageLog: number;
  private totalMessages: number;
  private maxMessageSize: number;
  private meanMessageSize: number;

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
    this.lastHeartbeatTime = Date.now();

    this.lastMessageLog = Date.now();
    this.totalMessages = 0;
    this.maxMessageSize = 0;
    this.meanMessageSize = 0;

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
        if (now - this.lastMessageLog > 45 * 1000) {
          console.log(
            `Client ${this.sessionId}: messages=${this.totalMessages} max(size)=${this.maxMessageSize} mean(size)=${this.meanMessageSize | 0}`,
          );
          this.lastMessageLog = now;
        }

        const serverMessage = ServerMessage.deserializeBinary(
          new Uint8Array(message),
        );
        this.messageQueue.push(serverMessage);
      } else {
        console.log('Received unsupported text message');
      }
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

  public getActiveChallenge(): Challenge | null {
    return this.activeChallenge;
  }

  public setActiveChallenge(challenge: Challenge | null): void {
    this.activeChallenge = challenge;
  }

  public sendMessage(message: ServerMessage): void {
    this.socket.send(message.serializeBinary());
  }

  public close(): void {
    this.socket.close();
  }

  public onClose(callback: () => void): void {
    this.closeCallbacks.push(callback);
  }

  private async processMessages(): Promise<void> {
    if (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift()!;

      if (message.getType() === ServerMessage.Type.PONG) {
        this.lastHeartbeatTime = Date.now();
      } else {
        await this.messageHandler.handleMessage(this, message);
      }
    }

    // Keep running forever.
    setTimeout(() => this.processMessages(), 20);
  }

  private async heartbeat(): Promise<void> {
    const ping = new ServerMessage();
    ping.setType(ServerMessage.Type.PING);
    this.sendMessage(ping);

    // Keep running forever.
    setTimeout(() => this.heartbeat(), Client.HEARTBEAT_INTERVAL_MS);
  }

  private cleanup(): void {
    if (this.activeChallenge !== null) {
      this.activeChallenge.removeClient(this);
      this.activeChallenge = null;
    }

    this.closeCallbacks.forEach((callback) => {
      callback();
    });

    this.sessionId = -1;
    this.closeCallbacks = [];
  }
}
