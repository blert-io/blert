import { Stage } from '@blert/common';
import { ServerMessage } from '@blert/common/generated/server_message_pb';
import { WebSocket } from 'ws';

import MessageHandler from './message-handler';
import { PluginVersions } from './verification';
import { BasicUser } from './users';
import logger, { runWithLogContext } from './log';

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

type ActiveChallengeInfo = {
  uuid: string;
  /** Mapping of stage to attempt number. */
  stages: Map<Stage, number | null>;
};

export default class Client {
  private static readonly HEARTBEAT_INTERVAL_MS = 5000;
  private static readonly HEARTBEAT_DISCONNECT_THRESHOLD = 10;
  private static readonly MESSAGE_LOOP_INTERVAL_MS = 20;

  private user: BasicUser;
  private pluginVersions: PluginVersions;
  private sessionId: number;
  private socket: WebSocket;
  private messageHandler: MessageHandler;
  private activeChallenge: ActiveChallengeInfo | null;
  private messageQueue: ServerMessage[];
  private isOpen: boolean;

  private closeCallbacks: (() => void)[];

  private heartbeatAcknowledged: boolean;
  private missedHeartbeats: number;

  private processTimeout: NodeJS.Timeout | null;
  private heartbeatTimeout: NodeJS.Timeout | null;

  private lastMessageLog: number;
  private stats: MessageStats;

  private loggedInRsn: string | null;

  constructor(
    socket: WebSocket,
    eventHandler: MessageHandler,
    user: BasicUser,
    pluginVersions: PluginVersions,
  ) {
    this.user = user;
    this.pluginVersions = pluginVersions;
    this.sessionId = -1;
    this.socket = socket;
    this.messageHandler = eventHandler;
    this.activeChallenge = null;
    this.closeCallbacks = [];
    this.messageQueue = [];
    this.isOpen = true;
    this.processTimeout = null;
    this.heartbeatTimeout = null;

    this.heartbeatAcknowledged = true;
    this.missedHeartbeats = 0;

    this.lastMessageLog = Date.now();
    this.stats = new MessageStats();

    this.loggedInRsn = null;

    socket.binaryType = 'arraybuffer';

    socket.on('close', (code) => {
      logger.info('client_socket_closed', this.logContext({ code }));
      this.cleanup();
    });
    socket.on('error', (error) => {
      logger.warn(
        'client_socket_error',
        this.logContext({
          error: error instanceof Error ? error : new Error(String(error)),
        }),
      );
      this.cleanup();
    });

    // Messages received through the socket are pushed into a message queue
    // where they are processed synchronously through the message loop.
    socket.on('message', (message: ArrayBuffer, isBinary) => {
      if (isBinary) {
        this.stats.recordIn(message.byteLength);

        const now = Date.now();
        if (now - this.lastMessageLog > 2 * 60 * 1000) {
          logger.info(
            'client_message_stats',
            this.logContext({
              inbound: this.stats.in,
              outbound: this.stats.out,
            }),
          );
          this.lastMessageLog = now;
        }

        try {
          const serverMessage = ServerMessage.deserializeBinary(
            new Uint8Array(message),
          );
          this.messageQueue.push(serverMessage);
        } catch (e) {
          logger.warn(
            'client_invalid_protobuf',
            this.logContext({
              error: e instanceof Error ? e : new Error(String(e)),
            }),
          );
        }
      } else {
        logger.warn('client_received_text_message', this.logContext());
      }
    });

    void this.withLogContext(() => this.processMessageLoop());
    void this.withLogContext(() => this.heartbeatLoop());
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

  /**
   * Returns the plugin info for this client.
   * @returns The plugin info.
   */
  public getPluginVersions(): Readonly<PluginVersions> {
    return this.pluginVersions;
  }

  public getActiveChallengeId(): string | null {
    return this.activeChallenge?.uuid ?? null;
  }

  public setActiveChallenge(
    challengeId: string,
    stages?: Map<Stage, number | null>,
  ): void {
    this.activeChallenge = {
      uuid: challengeId,
      stages: stages ?? new Map<Stage, number | null>(),
    };
    logger.info(
      'client_active_challenge_set',
      this.logContext({ challengeUuid: challengeId }),
    );
  }

  public clearActiveChallenge(): void {
    const previousChallengeUuid = this.activeChallenge?.uuid ?? null;
    this.activeChallenge = null;
    logger.info(
      'client_active_challenge_cleared',
      this.logContext({ previousChallengeUuid }),
    );
  }

  public setStageAttempt(stage: Stage, attempt: number | null): void {
    if (this.activeChallenge !== null) {
      const current = this.getStageAttempt(stage);
      if (current === undefined || current !== attempt) {
        const challengeUuid = this.activeChallenge.uuid;
        logger.debug(
          'client_stage_attempt_set',
          this.logContext({
            challengeUuid,
            stage,
            attempt,
          }),
        );
        this.activeChallenge.stages.set(stage, attempt);
      }
    }
  }

  public getStageAttempt(stage: Stage): number | null {
    return this.activeChallenge?.stages.get(stage) ?? null;
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

  private withLogContext<T>(
    fn: () => Promise<T> | T,
    extra?: Record<string, unknown>,
  ): Promise<T> | T {
    return runWithLogContext(this.logContext(extra), fn);
  }

  private logContext(extra?: Record<string, unknown>): Record<string, unknown> {
    return {
      userId: this.user.id,
      username: this.user.username,
      sessionId: this.sessionId,
      loggedInRsn: this.loggedInRsn ?? undefined,
      pluginVersion: this.pluginVersions.getVersion(),
      pluginRevision: this.pluginVersions.getRevision(),
      runeLiteVersion: this.pluginVersions.getRuneLiteVersion(),
      challengeUuid: this.activeChallenge?.uuid ?? undefined,
      ...extra,
    };
  }

  private async processMessageLoop(): Promise<void> {
    while (this.isOpen) {
      if (this.messageQueue.length > 0) {
        const message = this.messageQueue.shift()!;
        if (message.getType() === ServerMessage.Type.PONG) {
          this.heartbeatAcknowledged = true;
          this.missedHeartbeats = 0;
        } else {
          await this.messageHandler.handleMessage(this, message);
        }
      }

      await this.delay(Client.MESSAGE_LOOP_INTERVAL_MS, (timeout) => {
        this.processTimeout = timeout;
      });
    }
  }

  private async heartbeatLoop(): Promise<void> {
    while (this.isOpen) {
      const ping = new ServerMessage();
      ping.setType(ServerMessage.Type.PING);
      this.sendMessage(ping);

      if (!this.heartbeatAcknowledged) {
        this.missedHeartbeats++;

        if (this.missedHeartbeats >= Client.HEARTBEAT_DISCONNECT_THRESHOLD) {
          logger.warn(
            'client_unresponsive',
            this.logContext({ missedHeartbeats: this.missedHeartbeats }),
          );
          this.isOpen = false;
          this.close();
          return;
        }
      }

      this.heartbeatAcknowledged = false;

      await this.delay(Client.HEARTBEAT_INTERVAL_MS, (timeout) => {
        this.heartbeatTimeout = timeout;
      });
    }
  }

  private cleanup(): void {
    this.isOpen = false;

    if (this.processTimeout !== null) {
      clearTimeout(this.processTimeout);
      this.processTimeout = null;
    }
    if (this.heartbeatTimeout !== null) {
      clearTimeout(this.heartbeatTimeout);
      this.heartbeatTimeout = null;
    }

    this.closeCallbacks.forEach((callback) => {
      callback();
    });

    this.messageHandler.closeClient(this);

    this.sessionId = -1;
    this.closeCallbacks = [];
    this.activeChallenge = null;
  }

  private async delay(
    ms: number,
    store: (timeout: NodeJS.Timeout) => void,
  ): Promise<void> {
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, ms);
      store(timeout);
    });
  }
}
