import { RawData, WebSocket } from 'ws';

import EventHandler from './event-handler';
import Raid from './raid';

export default class Client {
  private sessionId: number;
  private socket: WebSocket;
  private eventHandler: EventHandler;
  private activeRaid: Raid | null;

  private closeCallbacks: (() => void)[];

  constructor(socket: WebSocket, eventHandler: EventHandler) {
    this.sessionId = -1;
    this.socket = socket;
    this.eventHandler = eventHandler;
    this.activeRaid = null;
    this.closeCallbacks = [];

    socket.on('close', () => this.cleanup());
    socket.on('message', (message) => this.processMessage(message));
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

  private processMessage(message: RawData): void {
    const events = JSON.parse(message.toString());
    if (Array.isArray(events)) {
      events.forEach((evt) => this.eventHandler.handleEvent(this, evt));
    } else {
      this.eventHandler.handleEvent(this, events);
    }
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
