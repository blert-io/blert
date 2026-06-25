import { ServerMessage } from '@blert/common/generated/server_message_pb';

import type Client from '../client';
import type ConnectionManager from '../connection-manager';
import ServerManager, { ServerStatus } from '../server-manager';

const DRAINING = ServerMessage.ServerStatus.Status.DRAINING;

class FakeClient {
  public readonly sent: ServerMessage[] = [];

  public sendMessage(message: ServerMessage): void {
    this.sent.push(message);
  }
}

class FakeConnectionManager {
  public list: FakeClient[] = [];
  public closeAllCount = 0;

  public clients(): readonly FakeClient[] {
    return this.list;
  }

  public closeAllClients(): void {
    this.closeAllCount += 1;
    this.list = [];
  }
}

function makeManager(clients: FakeClient[] = []): {
  manager: ServerManager;
  cm: FakeConnectionManager;
} {
  const cm = new FakeConnectionManager();
  cm.list = clients;
  const manager = new ServerManager(cm as unknown as ConnectionManager);
  return { manager, cm };
}

describe('draining', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('flips to DRAINING immediately and notifies status callbacks', () => {
    const { manager } = makeManager();
    const updates: ServerStatus[] = [];
    manager.onStatusUpdate(({ status }) => updates.push(status));

    manager.startDrain(jest.fn());

    expect(manager.getStatus().status).toBe(ServerStatus.DRAINING);
    expect(manager.getStatus().shutdownTime).not.toBeNull();
    expect(updates).toEqual([ServerStatus.DRAINING]);
  });

  it('waits out the settle delay before sending DRAINING with the deadline', async () => {
    const client = new FakeClient();
    const { manager } = makeManager([client]);

    manager.startDrain(jest.fn(), {
      settleDelay: 30_000,
      gracePeriod: 600_000,
    });
    expect(client.sent).toHaveLength(0);

    await jest.advanceTimersByTimeAsync(20_000);
    expect(client.sent).toHaveLength(0);

    await jest.advanceTimersByTimeAsync(30_000);

    expect(client.sent).toHaveLength(1);
    const message = client.sent[0];
    expect(message.getType()).toBe(ServerMessage.Type.SERVER_STATUS);
    expect(message.getServerStatus()?.getStatus()).toBe(DRAINING);
    expect(message.getServerStatus()?.hasShutdownTime()).toBe(true);
  });

  it('never closes a client while it remains within the grace period', async () => {
    const client = new FakeClient();
    const { manager, cm } = makeManager([client]);

    manager.startDrain(jest.fn(), {
      settleDelay: 30_000,
      gracePeriod: 600_000,
    });
    await jest.advanceTimersByTimeAsync(30_000);

    await jest.advanceTimersByTimeAsync(60_000);
    expect(cm.closeAllCount).toBe(0);

    await jest.advanceTimersByTimeAsync(60_000);
    expect(cm.closeAllCount).toBe(0);
    expect(manager.getStatus().status).toBe(ServerStatus.DRAINING);
    expect(client.sent).toHaveLength(1);
  });

  it('completes without force-closing once the last client leaves voluntarily', async () => {
    const client = new FakeClient();
    const onComplete = jest.fn();
    const { manager, cm } = makeManager([client]);

    manager.startDrain(onComplete, {
      settleDelay: 30_000,
      gracePeriod: 600_000,
    });
    await jest.advanceTimersByTimeAsync(30_000);

    // Client disconnects on its own.
    cm.list = [];
    await jest.advanceTimersByTimeAsync(5_000);

    expect(cm.closeAllCount).toBe(0);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(manager.getStatus().status).toBe(ServerStatus.OFFLINE);
  });

  it('force-closes remaining clients once the grace deadline passes', async () => {
    const client = new FakeClient();
    const onComplete = jest.fn();
    const { manager, cm } = makeManager([client]);

    manager.startDrain(onComplete, {
      settleDelay: 30_000,
      gracePeriod: 60_000,
    });

    await jest.advanceTimersByTimeAsync(30_000 + 60_000 + 5_000);

    expect(cm.closeAllCount).toBe(1);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(manager.getStatus().status).toBe(ServerStatus.OFFLINE);
  });

  it('completes after the settle delay when no clients are connected', async () => {
    const onComplete = jest.fn();
    const { manager, cm } = makeManager([]);

    manager.startDrain(onComplete, { settleDelay: 30_000 });
    await jest.advanceTimersByTimeAsync(30_000);

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(cm.closeAllCount).toBe(0);
    expect(manager.getStatus().status).toBe(ServerStatus.OFFLINE);
  });

  it('returns the server to RUNNING when canceled', async () => {
    const onComplete = jest.fn();
    const client = new FakeClient();
    const { manager } = makeManager([client]);

    manager.startDrain(onComplete, {
      settleDelay: 30_000,
      gracePeriod: 60_000,
    });
    manager.cancelDrain();

    expect(manager.getStatus().status).toBe(ServerStatus.SHUTDOWN_CANCELED);
    expect(manager.getStatus().shutdownTime).toBeNull();

    expect(client.sent.at(-1)?.getServerStatus()?.getStatus()).toBe(
      ServerMessage.ServerStatus.Status.SHUTDOWN_CANCELED,
    );

    await jest.advanceTimersByTimeAsync(120_000);

    expect(onComplete).not.toHaveBeenCalled();
    expect(manager.getStatus().status).toBe(ServerStatus.RUNNING);
  });

  it('ignores a second startDrain while one is already in progress', async () => {
    const first = jest.fn();
    const second = jest.fn();
    const { manager } = makeManager([]);

    manager.startDrain(first, { settleDelay: 30_000 });
    const deadline = manager.getStatus().shutdownTime;
    manager.startDrain(second, { settleDelay: 999_000 });

    // The second call was a no-op; the deadline is unchanged.
    expect(manager.getStatus().shutdownTime).toEqual(deadline);

    await jest.advanceTimersByTimeAsync(30_000);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });

  it('sends DRAINING to a client that connects mid-drain', () => {
    const { manager } = makeManager([]);
    manager.startDrain(jest.fn(), { settleDelay: 30_000 });

    const latecomer = new FakeClient();
    manager.handleNewClient(latecomer as unknown as Client);

    expect(latecomer.sent).toHaveLength(1);
    expect(latecomer.sent[0].getServerStatus()?.getStatus()).toBe(DRAINING);
  });

  it('supersedes a pending timed shutdown', async () => {
    const { manager } = makeManager([new FakeClient()]);

    // Enter SHUTDOWN_PENDING so both the shutdown and reminder timers are set.
    manager.scheduleShutdown(10 * 60_000);
    expect(manager.getStatus().status).toBe(ServerStatus.SHUTDOWN_PENDING);

    manager.startDrain(jest.fn(), { settleDelay: 30_000, gracePeriod: 60_000 });
    expect(manager.getStatus().status).toBe(ServerStatus.DRAINING);

    await jest.advanceTimersByTimeAsync(30_000);
    expect(manager.getStatus().status).toBe(ServerStatus.DRAINING);
  });
});
