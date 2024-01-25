import { Event } from '@blert/common';
import { WebSocket } from 'ws';

import EventHandler from './event-handler';
import Raid from './raid';

type SingleOrArray<T> = T | T[];

export default class Client {
  private sessionId: number;
  private socket: WebSocket;
  private eventHandler: EventHandler;
  private activeRaid: Raid | null;
  private messages: SingleOrArray<Event>[];

  private closeCallbacks: (() => void)[];

  constructor(socket: WebSocket, eventHandler: EventHandler) {
    this.sessionId = -1;
    this.socket = socket;
    this.eventHandler = eventHandler;
    this.activeRaid = null;
    this.closeCallbacks = [];
    this.messages = [];

    socket.on('close', () => this.cleanup());

    // Messages received through the socket are pushed into a message queue
    // where they are processed synchronously through `processMessages`.
    socket.on('message', (message) => {
      this.messages.push(JSON.parse(message.toString()));
    });

    setTimeout(() => this.processMessages(), 20);
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

  public getActiveRaid(): Raid | null {
    return this.activeRaid;
  }

  public setActiveRaid(raid: Raid | null): void {
    this.activeRaid = raid;
  }

  public sendMessage(message: Object): void {
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
      if (Array.isArray(message)) {
        for (const evt of message) {
          await this.eventHandler.handleEvent(this, evt);
        }
      } else {
        await this.eventHandler.handleEvent(this, message);
      }
    }

    // Keep running forever.
    setTimeout(() => this.processMessages(), 20);
  }

  private cleanup(): void {
    console.log(`Client ${this.sessionId} shutting down`);

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
