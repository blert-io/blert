import { ServerMessage } from '@blert/common/generated/server_message_pb';
import { Timestamp } from 'google-protobuf/google/protobuf/timestamp_pb';

import Client from './client';
import ConnectionManager from './connection-manager';
import logger from './log';
import { recordShutdownBroadcast, setServerStatusMetric } from './metrics';

export enum ServerStatus {
  RUNNING = 'RUNNING',
  SHUTDOWN_PENDING = 'SHUTDOWN_PENDING',
  SHUTDOWN_CANCELED = 'SHUTDOWN_CANCELED',
  SHUTDOWN_IMMINENT = 'SHUTDOWN_IMMINENT',
  OFFLINE = 'OFFLINE',
}

export type ServerStatusUpdate = {
  status: ServerStatus;
  shutdownTime: Date | null;
};

export default class ServerManager {
  // The default time to wait before shutting down the server.
  public static DEFAULT_SHUTDOWN_TIME = 30 * 60 * 1000;

  // Durations prior to shutdown at which to send a shutdown message to clients.
  private static SHUTDOWN_MESSAGE_INTERVALS = [
    60 * 60 * 1000,
    30 * 60 * 1000,
    15 * 60 * 1000,
    5 * 60 * 1000,
    1 * 60 * 1000,
  ];

  private connectionManager: ConnectionManager;
  private status: ServerStatus;
  private shutdownTime: Date | null;
  private statusUpdateCallbacks: ((status: ServerStatusUpdate) => void)[];

  private shutdownTimer: NodeJS.Timeout | null = null;
  private shutdownMessageTimer: NodeJS.Timeout | null = null;

  public constructor(connectionManager: ConnectionManager) {
    this.connectionManager = connectionManager;
    this.status = ServerStatus.RUNNING;
    this.shutdownTime = null;
    this.statusUpdateCallbacks = [];
    setServerStatusMetric(this.status);
  }

  /**
   * Registers a callback to be invoked whenever the server status changes.
   * @param callback The callback.
   */
  public onStatusUpdate(callback: (status: ServerStatusUpdate) => void): void {
    this.statusUpdateCallbacks.push(callback);
  }

  public getStatus(): ServerStatusUpdate {
    return {
      status: this.status,
      shutdownTime: this.shutdownTime,
    };
  }

  public hasPendingShutdown(): boolean {
    return this.shutdownTime !== null;
  }

  /**
   * Schedules a server shutdown to occur after a certain amount of time.
   *
   * @param timeFromNow Period of time to wait before shutting down the server.
   * @param force If true, the shutdown will be scheduled even if one is
   *     already pending, overriding the previous schedule.
   */
  public scheduleShutdown(timeFromNow?: number, force: boolean = false): void {
    if (this.hasPendingShutdown() && !force) {
      return;
    }

    const shutdownDuration =
      (timeFromNow ?? ServerManager.DEFAULT_SHUTDOWN_TIME) + 5000;
    this.shutdownTime = new Date(Date.now() + shutdownDuration);

    if (shutdownDuration > ServerManager.SHUTDOWN_MESSAGE_INTERVALS[0]) {
      const timeBeforePending =
        shutdownDuration - ServerManager.SHUTDOWN_MESSAGE_INTERVALS[0];
      logger.info('server_shutdown_scheduled', {
        shutdownTime: this.shutdownTime.toISOString(),
        countdownStart: new Date(Date.now() + timeBeforePending).toISOString(),
      });
      this.shutdownTimer = setTimeout(
        () => this.enterShutdownPending(),
        timeBeforePending,
      );
    } else {
      this.enterShutdownPending();
    }
  }

  private enterShutdownPending(): void {
    if (this.shutdownTime === null) {
      return;
    }

    logger.info('server_shutdown_pending', {
      shutdownTime: this.shutdownTime.toISOString(),
    });

    const shutdownDuration = this.shutdownTime.getTime() - Date.now();
    this.shutdownTimer = setTimeout(() => this.shutdown(), shutdownDuration);

    this.updateStatus(ServerStatus.SHUTDOWN_PENDING);
    this.scheduleNextShutdownMessage();
  }

  /**
   * Cancels a pending server shutdown.
   */
  public cancelShutdown(): void {
    if (!this.hasPendingShutdown()) {
      return;
    }

    if (this.shutdownTimer !== null) {
      clearTimeout(this.shutdownTimer);
      this.shutdownTimer = null;
    }

    if (this.shutdownMessageTimer !== null) {
      clearTimeout(this.shutdownMessageTimer);
      this.shutdownMessageTimer = null;
    }

    this.shutdownTime = null;
    this.updateStatus(ServerStatus.SHUTDOWN_CANCELED);
    this.notifyAllClientsOfState();

    logger.info('server_shutdown_canceled');

    setTimeout(() => this.updateStatus(ServerStatus.RUNNING), 10000);
  }

  private shutdown(): void {
    this.updateStatus(ServerStatus.SHUTDOWN_IMMINENT);
    this.notifyAllClientsOfState();

    setTimeout(() => {
      this.connectionManager.closeAllClients();
      this.updateStatus(ServerStatus.OFFLINE);

      // Don't actually exit the process to prevent it from being restarted by
      // a system service. Leave it in a zombie state to be restarted manually.
      logger.info('server_shutdown_complete');
    }, 2000);
  }

  private updateStatus(newStatus: ServerStatus): void {
    this.status = newStatus;
    setServerStatusMetric(newStatus);
    this.statusUpdateCallbacks.forEach((callback) =>
      callback({
        status: this.status,
        shutdownTime: this.shutdownTime,
      }),
    );
  }

  private scheduleNextShutdownMessage(): void {
    if (this.status !== ServerStatus.SHUTDOWN_PENDING) {
      this.shutdownMessageTimer = null;
      return;
    }

    const nextInterval = this.nextShutdownMessageInterval();
    if (nextInterval === 0) {
      this.shutdownMessageTimer = null;
      return;
    }

    const nextMessageTime = this.shutdownTime!.getTime() - nextInterval;
    const messageTimeout = nextMessageTime - Date.now();

    logger.debug('server_shutdown_message_scheduled', {
      messageTimeoutMs: messageTimeout,
    });
    this.shutdownMessageTimer = setTimeout(() => {
      this.notifyAllClientsOfState();
      this.scheduleNextShutdownMessage();
    }, messageTimeout);
  }

  public handleNewClient(client: Client): void {
    if (this.hasPendingShutdown()) {
      client.sendMessage(this.serverStatusMessage());
    }
  }

  /**
   * Broadcasts a message to all connected clients.
   * @param message The message to broadcast.
   */
  public broadcastMessage(message: ServerMessage): void {
    const activeClients = this.connectionManager.clients();
    logger.info('server_broadcast', {
      messageType: message.getType(),
      clientCount: activeClients.length,
    });

    for (const client of activeClients) {
      client.sendMessage(message);
    }
  }

  private nextShutdownMessageInterval(): number {
    const timeUntilShutdown = this.shutdownTime!.getTime() - Date.now();
    for (const interval of ServerManager.SHUTDOWN_MESSAGE_INTERVALS) {
      const adjustedInterval = interval + 1000;
      if (timeUntilShutdown > adjustedInterval) {
        return adjustedInterval;
      }
    }

    return 0;
  }

  /**
   * Sends a `SERVER_STATUS` server message to all connected clients with the
   * current server status.
   */
  private notifyAllClientsOfState(): void {
    const statusMessage = this.serverStatusMessage();

    const activeClients = this.connectionManager.clients();
    logger.debug('server_status_broadcast', {
      status: this.status,
      clientCount: activeClients.length,
    });
    recordShutdownBroadcast(this.status);

    for (const client of activeClients) {
      client.sendMessage(statusMessage);
    }
  }

  private serverStatusMessage(): ServerMessage {
    const shutdownMessage = new ServerMessage();
    shutdownMessage.setType(ServerMessage.Type.SERVER_STATUS);
    const serverStatus = new ServerMessage.ServerStatus();

    switch (this.status) {
      case ServerStatus.RUNNING:
        serverStatus.setStatus(ServerMessage.ServerStatus.Status.RUNNING);
        break;
      case ServerStatus.SHUTDOWN_PENDING:
        serverStatus.setStatus(
          ServerMessage.ServerStatus.Status.SHUTDOWN_PENDING,
        );
        serverStatus.setShutdownTime(Timestamp.fromDate(this.shutdownTime!));
        break;
      case ServerStatus.SHUTDOWN_CANCELED:
        serverStatus.setStatus(
          ServerMessage.ServerStatus.Status.SHUTDOWN_CANCELED,
        );
        break;
      case ServerStatus.SHUTDOWN_IMMINENT:
        serverStatus.setStatus(
          ServerMessage.ServerStatus.Status.SHUTDOWN_IMMINENT,
        );
        break;
    }

    shutdownMessage.setServerStatus(serverStatus);
    return shutdownMessage;
  }
}
