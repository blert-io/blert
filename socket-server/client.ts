import { Stage } from '@blert/common';
import { ServerMessage } from '@blert/common/generated/server_message_pb';
import { RawData, WebSocket } from 'ws';
import { z } from 'zod';

import MessageHandler from './message-handler';
import { PluginVersions } from './verification';
import { BasicUser } from './users';
import logger, { runWithLogContext } from './log';
import {
  observeMessageBytes,
  recordClientDisconnection,
  recordInvalidMessage,
} from './metrics';
import {
  jsonToServerMessage,
  MessageFormat,
  serverMessageToJson,
} from './protocol';

type Stats = {
  total: number;
  maxSize: number;
  meanSize: number;
  totalBytes: number;
};

class MessageStats {
  public in: Stats;
  public out: Stats;

  constructor() {
    this.in = { total: 0, maxSize: 0, meanSize: 0, totalBytes: 0 };
    this.out = { total: 0, maxSize: 0, meanSize: 0, totalBytes: 0 };
  }

  public recordIn(format: MessageFormat, size: number): void {
    observeMessageBytes('in', format, size);
    this.updateStats(this.in, size);
  }

  public recordOut(format: MessageFormat, size: number): void {
    observeMessageBytes('out', format, size);
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
    stats.totalBytes += size;
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
  private static readonly MESSAGE_STATS_INTERVAL_MS = 2 * 60 * 1000;

  /** Delay after connection before sending the first GAME_STATE_REQUEST. */
  private static readonly GAME_STATE_REQUEST_INITIAL_DELAY_MS = 1000;
  /** Interval between GAME_STATE_REQUEST retries. */
  private static readonly GAME_STATE_REQUEST_RETRY_INTERVAL_MS = 5000;
  /** Maximum number of GAME_STATE_REQUEST messages to send. */
  private static readonly GAME_STATE_REQUEST_MAX_ATTEMPTS = 5;

  private user: BasicUser;
  private pluginVersions: PluginVersions;
  private messageFormat: MessageFormat;
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
  private gameStateRequestTimeout: NodeJS.Timeout | null;
  private gameStateRequestAttempts: number;

  private lastMessageLog: number;
  private stats: MessageStats;

  private loggedInRsn: string | null;

  constructor(
    socket: WebSocket,
    eventHandler: MessageHandler,
    user: BasicUser,
    pluginVersions: PluginVersions,
    messageFormat: MessageFormat = MessageFormat.PROTOBUF,
  ) {
    this.user = user;
    this.pluginVersions = pluginVersions;
    this.messageFormat = messageFormat;
    this.sessionId = -1;
    this.socket = socket;
    this.messageHandler = eventHandler;
    this.activeChallenge = null;
    this.closeCallbacks = [];
    this.messageQueue = [];
    this.isOpen = true;
    this.processTimeout = null;
    this.heartbeatTimeout = null;
    this.gameStateRequestTimeout = null;
    this.gameStateRequestAttempts = 0;

    this.heartbeatAcknowledged = true;
    this.missedHeartbeats = 0;

    this.lastMessageLog = Date.now();
    this.stats = new MessageStats();

    this.loggedInRsn = null;

    socket.binaryType = 'arraybuffer';

    socket.on('close', (code) => {
      logger.info('client_socket_closed', this.logContext({ code }));
      recordClientDisconnection('close', code);
      this.cleanup();
    });
    socket.on('error', (error) => {
      logger.warn(
        'client_socket_error',
        this.logContext({
          error: error instanceof Error ? error : new Error(String(error)),
        }),
      );
      recordClientDisconnection('error');
      this.cleanup();
    });

    // Messages received through the socket are pushed into a message queue
    // where they are processed synchronously through the message loop.
    socket.on('message', (raw: RawData, isBinary: boolean) => {
      let message: Buffer;
      if (Buffer.isBuffer(raw)) {
        message = raw;
      } else if (raw instanceof ArrayBuffer) {
        message = Buffer.from(raw);
      } else {
        message = Buffer.concat(raw);
      }

      this.stats.recordIn(this.messageFormat, message.length);

      const serverMessage = this.parseMessage(message, isBinary);
      if (serverMessage !== null) {
        this.messageQueue.push(serverMessage);
      }

      const now = Date.now();
      if (now - this.lastMessageLog > Client.MESSAGE_STATS_INTERVAL_MS) {
        logger.info(
          'client_message_stats',
          this.logContext({
            inbound: this.stats.in,
            outbound: this.stats.out,
          }),
        );
        this.lastMessageLog = now;
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
   * Updates the linked player ID for this client. Used when a name change
   * merges two player records and the client's original player ID is deleted.
   * @param playerId The new player ID.
   */
  public setLinkedPlayerId(playerId: number): void {
    this.user.linkedPlayerId = playerId;
  }

  /**
   * Returns the plugin info for this client.
   * @returns The plugin info.
   */
  public getPluginVersions(): Readonly<PluginVersions> {
    return this.pluginVersions;
  }

  /**
   * Returns the wire format used for communication with this client.
   * @returns The message format (JSON or PROTOBUF).
   */
  public getMessageFormat(): MessageFormat {
    return this.messageFormat;
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

  /**
   * Starts the game state request cycle. After an initial delay, sends a
   * GAME_STATE_REQUEST to the client. If no valid GAME_STATE response is
   * received, retries up to the maximum number of attempts.
   *
   * This should be called after the client has been sent a CONNECTION_RESPONSE.
   */
  public startGameStateRequestCycle(): void {
    this.cancelGameStateRequest();

    this.gameStateRequestAttempts = 0;
    this.gameStateRequestTimeout = setTimeout(
      () => this.sendGameStateRequest(),
      Client.GAME_STATE_REQUEST_INITIAL_DELAY_MS,
    );
  }

  /**
   * Cancels any pending game state request. Should be called when a valid
   * GAME_STATE message is received from the client.
   */
  public cancelGameStateRequest(): void {
    if (this.gameStateRequestTimeout !== null) {
      clearTimeout(this.gameStateRequestTimeout);
      this.gameStateRequestTimeout = null;
    }
  }

  private sendGameStateRequest(): void {
    if (
      this.gameStateRequestAttempts === Client.GAME_STATE_REQUEST_MAX_ATTEMPTS
    ) {
      logger.warn(
        'client_game_state_request_max_attempts',
        this.logContext({
          attempts: this.gameStateRequestAttempts,
        }),
      );
      this.gameStateRequestTimeout = null;
      return;
    }

    this.gameStateRequestAttempts++;

    logger.debug(
      'client_game_state_request_sent',
      this.logContext({
        attempt: this.gameStateRequestAttempts,
      }),
    );

    const request = new ServerMessage();
    request.setType(ServerMessage.Type.GAME_STATE_REQUEST);
    this.sendMessage(request);

    this.gameStateRequestTimeout = setTimeout(
      () => this.sendGameStateRequest(),
      Client.GAME_STATE_REQUEST_RETRY_INTERVAL_MS,
    );
  }

  public sendMessage(message: ServerMessage): void {
    if (this.isOpen) {
      if (this.messageFormat === MessageFormat.JSON) {
        const json = serverMessageToJson(message);
        const serialized = JSON.stringify(json);
        this.socket.send(serialized);
        this.stats.recordOut(
          this.messageFormat,
          Buffer.byteLength(serialized, 'utf8'),
        );
      } else {
        const serialized = message.serializeBinary();
        this.socket.send(serialized);
        this.stats.recordOut(this.messageFormat, serialized.length);
      }
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
      messageFormat: this.messageFormat,
      ...extra,
    };
  }

  private parseMessage(
    message: Buffer,
    isBinary: boolean,
  ): ServerMessage | null {
    switch (this.messageFormat) {
      case MessageFormat.JSON: {
        if (isBinary) {
          recordInvalidMessage('unexpected_binary');
          logger.warn(
            'client_unexpected_binary_message',
            this.logContext({ messageLength: message.length }),
          );
          return null;
        }

        try {
          const parsed: unknown = JSON.parse(message.toString());
          return jsonToServerMessage(parsed);
        } catch (e) {
          if (e instanceof SyntaxError) {
            recordInvalidMessage('json_syntax');
          } else if (e instanceof z.ZodError) {
            recordInvalidMessage('json_schema');
          } else {
            recordInvalidMessage('json_conversion');
          }
          logger.warn(
            'client_invalid_json',
            this.logContext({
              error: e instanceof Error ? e : new Error(String(e)),
            }),
          );
          return null;
        }
      }

      case MessageFormat.PROTOBUF: {
        if (!isBinary) {
          recordInvalidMessage('text');
          logger.warn(
            'client_unexpected_text_message',
            this.logContext({ messageLength: message.length }),
          );
          return null;
        }

        try {
          return ServerMessage.deserializeBinary(new Uint8Array(message));
        } catch (e) {
          recordInvalidMessage('protobuf');
          logger.warn(
            'client_invalid_protobuf',
            this.logContext({
              error: e instanceof Error ? e : new Error(String(e)),
            }),
          );
          return null;
        }
      }
    }

    return null;
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
          recordClientDisconnection('unresponsive');
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
    if (this.gameStateRequestTimeout !== null) {
      clearTimeout(this.gameStateRequestTimeout);
      this.gameStateRequestTimeout = null;
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
