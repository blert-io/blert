import { ServerMessage } from '@blert/common/generated/server_message_pb';

import type Client from '../client';
import type ConnectionManager from '../connection-manager';
import ServerManager, { ServerStatus } from '../server-manager';

class FakeClient {
  public readonly sent: ServerMessage[] = [];

  constructor(
    public readonly sessionId: number = 0,
    private activeChallengeId: string | null = null,
  ) {}

  public getSessionId(): number {
    return this.sessionId;
  }

  public getActiveChallengeId(): string | null {
    return this.activeChallengeId;
  }

  public setActiveChallenge(challengeId: string | null): void {
    this.activeChallengeId = challengeId;
  }

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

  public getClient(sessionId: number): FakeClient | undefined {
    return this.list.find((c) => c.getSessionId() === sessionId);
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
  const DRAINING = ServerMessage.ServerStatus.Status.DRAINING;

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

describe('rebalancing', () => {
  const REBALANCING = ServerMessage.ServerStatus.Status.REBALANCING;

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  const rebalanceStatus = (client: FakeClient): number | undefined =>
    client.sent[0]?.getServerStatus()?.getStatus();

  const signaledClients = (clients: FakeClient[]): FakeClient[] =>
    clients.filter((c) => rebalanceStatus(c) === REBALANCING);

  it('signals only idle clients', () => {
    const idle = [new FakeClient(1), new FakeClient(2), new FakeClient(3)];
    const busy = [new FakeClient(4, 'c-a'), new FakeClient(5, 'c-b')];
    const { manager } = makeManager([...idle, ...busy]);

    const result = manager.startRebalance({ target: 2 });

    expect(result).toEqual({
      started: true,
      total: 5,
      idle: 3,
      target: 2,
      selected: 3,
    });

    for (const client of idle) {
      expect(client.sent).toHaveLength(1);
      expect(client.sent[0].getType()).toBe(ServerMessage.Type.SERVER_STATUS);
      expect(rebalanceStatus(client)).toBe(REBALANCING);
      expect(client.sent[0].getServerStatus()?.hasShutdownTime()).toBe(false);
    }
    for (const client of busy) {
      expect(client.sent).toHaveLength(0);
    }

    // The server stays healthy.
    expect(manager.getStatus().status).toBe(ServerStatus.RUNNING);
  });

  it('caps the selected count at the idle count', () => {
    const clients = [
      new FakeClient(1),
      new FakeClient(2, 'c-a'),
      new FakeClient(3, 'c-b'),
      new FakeClient(4, 'c-c'),
    ];
    const { manager } = makeManager(clients);

    const result = manager.startRebalance({ target: 0 });

    expect(result.selected).toBe(1);
    expect(signaledClients(clients)).toEqual([clients[0]]);
  });

  it('does nothing when already at or below the target', () => {
    const clients = [new FakeClient(1), new FakeClient(2)];
    const { manager } = makeManager(clients);

    const result = manager.startRebalance({ target: 5 });

    expect(result).toEqual({
      started: true,
      total: 2,
      idle: 2,
      target: 5,
      selected: 0,
    });
    expect(signaledClients(clients)).toEqual([]);
  });

  it('spreads notifications across batches with the batch interval', () => {
    const clients = [1, 2, 3, 4, 5].map((id) => new FakeClient(id));
    const { manager } = makeManager(clients);

    manager.startRebalance({ target: 0, batchSize: 2, batchIntervalMs: 1000 });

    // First batch fires synchronously.
    expect(signaledClients(clients)).toHaveLength(2);

    jest.advanceTimersByTime(1000);
    expect(signaledClients(clients)).toHaveLength(4);

    jest.advanceTimersByTime(1000);
    expect(signaledClients(clients)).toHaveLength(5);

    expect(clients.every((c) => c.sent.length === 1)).toBe(true);
  });

  it('skips a selected client that entered a challenge before its batch', () => {
    const clients = [1, 2, 3, 4].map((id) => new FakeClient(id));
    const { manager } = makeManager(clients);

    manager.startRebalance({ target: 0, batchSize: 2, batchIntervalMs: 1000 });

    expect(signaledClients(clients)).toEqual([clients[0], clients[1]]);

    clients[2].setActiveChallenge('c-late');
    jest.advanceTimersByTime(1000);

    expect(signaledClients(clients)).toEqual([
      clients[0],
      clients[1],
      clients[3],
    ]);
    expect(clients[2].sent).toHaveLength(0);
  });

  it('skips a selected client that disconnected before its batch', () => {
    const clients = [1, 2, 3, 4].map((id) => new FakeClient(id));
    const { manager, cm } = makeManager(clients);

    manager.startRebalance({ target: 0, batchSize: 2, batchIntervalMs: 1000 });

    cm.list = cm.list.filter((c) => c.getSessionId() !== 3);
    jest.advanceTimersByTime(1000);

    expect(clients[2].sent).toHaveLength(0);
    expect(clients[3].sent).toHaveLength(1);
    expect(rebalanceStatus(clients[3])).toBe(REBALANCING);
  });

  it('is rejected while the instance is draining', () => {
    const clients = [new FakeClient(1), new FakeClient(2)];
    const { manager } = makeManager(clients);

    manager.startDrain(jest.fn(), { settleDelay: 30_000, gracePeriod: 60_000 });
    const result = manager.startRebalance({ target: 0 });

    expect(result.started).toBe(false);
    expect(result.selected).toBe(0);
    expect(signaledClients(clients)).toEqual([]);
    expect(manager.getStatus().status).toBe(ServerStatus.DRAINING);
  });

  it('is rejected while a rebalance is already in progress', () => {
    const clients = [1, 2, 3].map((id) => new FakeClient(id));
    const { manager } = makeManager(clients);

    const first = manager.startRebalance({
      target: 0,
      batchSize: 1,
      batchIntervalMs: 1000,
    });
    expect(first.started).toBe(true);
    expect(signaledClients(clients)).toHaveLength(1);

    const second = manager.startRebalance({ target: 0 });
    expect(second.started).toBe(false);

    // The second request notified no new clients.
    expect(signaledClients(clients)).toHaveLength(1);
  });

  it('aborts a rebalance when a drain begins', () => {
    const clients = [1, 2, 3, 4].map((id) => new FakeClient(id));
    const { manager } = makeManager(clients);

    manager.startRebalance({ target: 0, batchSize: 1, batchIntervalMs: 1000 });
    expect(signaledClients(clients)).toHaveLength(1);

    manager.startDrain(jest.fn(), { settleDelay: 30_000, gracePeriod: 60_000 });

    jest.advanceTimersByTime(10_000);
    expect(signaledClients(clients)).toHaveLength(1);
  });

  it('falls back to the default batch size when given a nonpositive one', () => {
    const clients = [1, 2, 3].map((id) => new FakeClient(id));
    const { manager } = makeManager(clients);

    manager.startRebalance({ target: 0, batchSize: 0, batchIntervalMs: 1000 });
    expect(signaledClients(clients)).toHaveLength(3);

    jest.advanceTimersByTime(5000);
    expect(signaledClients(clients)).toHaveLength(3);
  });

  it('does not change the server status or fire status callbacks', () => {
    const updates: ServerStatus[] = [];
    const { manager } = makeManager([new FakeClient(1)]);
    manager.onStatusUpdate(({ status }) => updates.push(status));

    manager.startRebalance({ target: 0 });

    expect(manager.getStatus().status).toBe(ServerStatus.RUNNING);
    expect(manager.getStatus().shutdownTime).toBeNull();
    expect(updates).toEqual([]);
  });
});
