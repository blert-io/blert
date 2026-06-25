import { ServerMessage } from '@blert/common/generated/server_message_pb';
import { Timestamp } from 'google-protobuf/google/protobuf/timestamp_pb';

import Client from './client';
import ConnectionManager from './connection-manager';
import logger from './log';
import { recordShutdownBroadcast, setServerStatusMetric } from './metrics';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export enum ServerStatus {
  RUNNING = 'RUNNING',
  SHUTDOWN_PENDING = 'SHUTDOWN_PENDING',
  SHUTDOWN_CANCELED = 'SHUTDOWN_CANCELED',
  SHUTDOWN_IMMINENT = 'SHUTDOWN_IMMINENT',
  DRAINING = 'DRAINING',
  OFFLINE = 'OFFLINE',
}

export type DrainOptions = {
  /** How long clients have to leave voluntarily before being force-closed. */
  gracePeriod?: number;
  /**
   * How long to wait after flipping unhealthy before asking clients to
   * reconnect, giving the load balancer time to stop routing to this instance.
   */
  settleDelay?: number;
};

/** All state for an in-progress cooperative drain; null when not draining. */
type DrainState = {
  settleTimer: NodeJS.Timeout | null;
  lastRemaining: number;
  onComplete: () => void;
};

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

  // How long a cooperative drain lets clients leave voluntarily before the
  // remaining clients are force-closed.
  public static DEFAULT_DRAIN_GRACE_PERIOD_MS = 45 * 60 * 1000;

  // How long to wait after flipping unhealthy before asking clients to leave,
  // so a load balancer observes the unhealthy state first.
  public static DEFAULT_DRAIN_SETTLE_MS = 30 * 1000;

  // How often the drain monitor checks whether all clients have left.
  private static DRAIN_TICK_MS = 5 * 1000;

  private connectionManager: ConnectionManager;
  private status: ServerStatus;
  private shutdownTime: Date | null;
  private statusUpdateCallbacks: ((status: ServerStatusUpdate) => void)[];

  private shutdownTimer: NodeJS.Timeout | null = null;
  private shutdownMessageTimer: NodeJS.Timeout | null = null;

  private drain: DrainState | null = null;

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
      void this.connectionManager.closeAllClients();
      this.updateStatus(ServerStatus.OFFLINE);

      // Don't actually exit the process to prevent it from being restarted by
      // a system service. Leave it in a zombie state to be restarted manually.
      logger.info('server_shutdown_complete');
    }, 2000);
  }

  /**
   * Begins a cooperative drain of this instance to another.
   *
   * The instance is marked unhealthy (so a load balancer stops routing new
   * connections to it) and, after a settle delay, asks connected clients to
   * reconnect elsewhere once they are idle. Clients leave at their own
   * convenience; any still connected after the grace period are force-closed.
   * When the last client leaves, or the grace period elapses, `onComplete` is
   * invoked so the caller can release resources and exit the process.
   */
  public startDrain(onComplete: () => void, options: DrainOptions = {}): void {
    if (this.drain !== null || this.status === ServerStatus.OFFLINE) {
      logger.debug('server_drain_ignored', { status: this.status });
      return;
    }

    // A drain supersedes a pending timed shutdown; both end in process death,
    // but the drain exits cleanly.
    if (this.shutdownTimer !== null) {
      clearTimeout(this.shutdownTimer);
      this.shutdownTimer = null;
    }
    if (this.shutdownMessageTimer !== null) {
      clearTimeout(this.shutdownMessageTimer);
      this.shutdownMessageTimer = null;
    }

    const gracePeriod =
      options.gracePeriod ?? ServerManager.DEFAULT_DRAIN_GRACE_PERIOD_MS;
    const settleDelay =
      options.settleDelay ?? ServerManager.DEFAULT_DRAIN_SETTLE_MS;

    this.shutdownTime = new Date(Date.now() + settleDelay + gracePeriod);
    this.drain = {
      settleTimer: setTimeout(() => void this.runDrain(), settleDelay),
      lastRemaining: -1,
      onComplete,
    };

    logger.info('server_drain_started', {
      gracePeriod,
      settleDelay,
      deadline: this.shutdownTime.toISOString(),
    });

    // Flip to DRAINING so the rest of the system can take appropriate action,
    // such as switching the health check to unhealthy, then wait out the settle
    // delay before taking further action.
    this.updateStatus(ServerStatus.DRAINING);
  }

  /**
   * Cancels an in-progress drain, returning the server to a running state.
   */
  public cancelDrain(): void {
    if (this.drain === null) {
      return;
    }

    if (this.drain.settleTimer !== null) {
      clearTimeout(this.drain.settleTimer);
    }
    this.drain = null;
    this.shutdownTime = null;

    logger.info('server_drain_canceled');

    this.updateStatus(ServerStatus.SHUTDOWN_CANCELED);
    this.notifyAllClientsOfState();

    setTimeout(() => this.updateStatus(ServerStatus.RUNNING), 10_000);
  }

  /**
   * Asks all connected clients to reconnect elsewhere, then polls until they
   * have all left or the grace period has elapsed.
   */
  private async runDrain(): Promise<void> {
    if (this.drain === null) {
      // Canceled during the settle delay.
      return;
    }
    this.drain.settleTimer = null;

    logger.info('server_drain_settled', {
      clientCount: this.connectionManager.clients().length,
    });

    this.notifyAllClientsOfState();

    while (this.drain !== null && !this.hasDrained()) {
      const remaining = this.connectionManager.clients().length;
      if (remaining !== this.drain.lastRemaining) {
        this.drain.lastRemaining = remaining;
        logger.info('server_drain_progress', { remaining });
      }

      await sleep(ServerManager.DRAIN_TICK_MS);
    }

    if (this.drain !== null) {
      const drain = this.drain;
      this.drain = null;
      await this.completeDrain(drain);
    }
  }

  private hasDrained(): boolean {
    return (
      this.connectionManager.clients().length === 0 ||
      Date.now() >= this.shutdownTime!.getTime()
    );
  }

  /**
   * Finishes the drain by force-closing any remaining clients and invoking the
   * drain completion callback so the process can tear down and exit.
   */
  private async completeDrain(drain: DrainState): Promise<void> {
    const { onComplete } = drain;

    const forceClosed = this.connectionManager.clients().length;
    if (forceClosed > 0) {
      await this.connectionManager.closeAllClients();
    }

    logger.info('server_drain_complete', { forceClosed });

    this.updateStatus(ServerStatus.OFFLINE);
    onComplete();
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
      case ServerStatus.DRAINING:
        serverStatus.setStatus(ServerMessage.ServerStatus.Status.DRAINING);
        serverStatus.setShutdownTime(Timestamp.fromDate(this.shutdownTime!));
        break;
    }

    shutdownMessage.setServerStatus(serverStatus);
    return shutdownMessage;
  }
}
