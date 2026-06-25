import { ServerMessage } from '@blert/common/generated/server_message_pb';

jest.mock('../users', () => ({ Users: {} }));

import type Client from '../client';
import ConnectionManager from '../connection-manager';

// ConnectionManager imports Users, which imports the database module and exits
// the process at load when BLERT_DATABASE_URI is unset. These tests don't touch
// authentication, so cut that chain.
jest.mock('../users', () => ({ Users: {} }));

class FakeClient {
  public session: { id: number; token: string } | null = null;
  public closeCode: number | null = null;
  public terminated = false;

  private readonly closeCallbacks: (() => void)[] = [];

  public constructor(private readonly echoesClose: boolean) {}

  public setSession(session: { id: number; token: string }): void {
    this.session = session;
  }
  public getSessionId(): number {
    return this.session!.id;
  }
  public getUserId(): number {
    return 1;
  }
  public getUsername(): string {
    return 'tester';
  }
  public getPluginVersions() {
    return { getVersion: () => '0.9.11', getRuneLiteVersion: () => '1.12.31' };
  }
  public onClose(cb: () => void): void {
    this.closeCallbacks.push(cb);
  }
  public sendMessage(): void {
    /* no-op */
  }
  public startGameStateRequestCycle(): void {
    /* no-op */
  }

  public close(code: number): void {
    this.closeCode = code;
    if (this.echoesClose) {
      this.fireClose();
    }
  }
  public terminate(): void {
    this.terminated = true;
    this.fireClose();
  }

  private fireClose(): void {
    for (const cb of [...this.closeCallbacks]) {
      cb();
    }
  }
}

function makeConnectionManager(): ConnectionManager {
  const definitionsRepository = {
    createAttackDefinitionsMessage: () => new ServerMessage(),
    createSpellDefinitionsMessage: () => new ServerMessage(),
  };
  return new ConnectionManager(
    null,
    definitionsRepository as unknown as ConstructorParameters<
      typeof ConnectionManager
    >[1],
  );
}

function addFakeClients(cm: ConnectionManager, ...clients: FakeClient[]): void {
  for (const client of clients) {
    cm.addClient(client as unknown as Client);
  }
}

describe('closeAllClients', () => {
  afterEach(() => jest.useRealTimers());

  it('closes clients gracefully and resolves without terminating', async () => {
    const cm = makeConnectionManager();
    const a = new FakeClient(true);
    const b = new FakeClient(true);
    addFakeClients(cm, a, b);

    await cm.closeAllClients();

    expect(a.closeCode).toBe(1001);
    expect(b.closeCode).toBe(1001);
    expect(a.terminated).toBe(false);
    expect(b.terminated).toBe(false);
    expect(cm.clients()).toHaveLength(0);
  });

  it('terminates clients that never complete the handshake', async () => {
    jest.useFakeTimers();
    const cm = makeConnectionManager();

    // a never completes the handshake; b closes gracefully.
    const a = new FakeClient(false);
    const b = new FakeClient(true);
    addFakeClients(cm, a, b);

    let hasClosed = false;

    const closed = cm.closeAllClients().then(() => {
      hasClosed = true;
    });

    await jest.advanceTimersByTimeAsync(1000);

    expect(a.closeCode).toBe(1001);
    expect(b.closeCode).toBe(1001);
    expect(a.terminated).toBe(false);
    expect(b.terminated).toBe(false);
    expect(hasClosed).toBe(false);
    expect(cm.clients()).toHaveLength(1);

    // After the handshake timeout the stragglers are terminated.
    await jest.advanceTimersByTimeAsync(5000);
    await closed;

    expect(a.terminated).toBe(true);
    expect(b.terminated).toBe(false);
    expect(cm.clients()).toHaveLength(0);
    expect(hasClosed).toBe(true);
  });

  it('resolves immediately when there are no clients', async () => {
    const cm = makeConnectionManager();
    await expect(cm.closeAllClients()).resolves.toBeUndefined();
  });
});
