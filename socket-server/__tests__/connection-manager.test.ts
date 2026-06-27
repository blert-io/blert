import { ServerMessage } from '@blert/common/generated/server_message_pb';
import { RedisClientType } from 'redis';

jest.mock('../users', () => ({ Users: {} }));

import { DEFINITIONS_RELOAD_PUBSUB_KEY } from '../action-definitions';
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
  public readonly sentMessages: unknown[] = [];

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

  public sendMessage(message?: unknown): void {
    this.sentMessages.push(message);
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

type PubSubHandler = (message: string) => void | Promise<void>;

class FakePubSubClient {
  public readonly handlers = new Map<string, PubSubHandler>();

  public on(): this {
    return this;
  }

  public async connect(): Promise<void> {
    /* no-op */
  }

  public async subscribe(
    channel: string,
    handler: PubSubHandler,
  ): Promise<void> {
    this.handlers.set(channel, handler);
  }

  /** Simulates Redis delivering a published message to this subscriber. */
  public async deliver(channel: string, message: string): Promise<void> {
    const handler = this.handlers.get(channel);
    if (handler === undefined) {
      throw new Error(`no subscriber for ${channel}`);
    }
    await handler(message);
  }
}

class FakeRedisClient {
  public readonly pubsub = new FakePubSubClient();
  public duplicate(): FakePubSubClient {
    return this.pubsub;
  }
}

/** Lets the fire-and-forget startPubsub() chain register its subscriptions. */
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('definitions reload pubsub', () => {
  async function setup() {
    const attackMessage = new ServerMessage();
    attackMessage.setType(ServerMessage.Type.ATTACK_DEFINITIONS);

    const spellMessage = new ServerMessage();
    spellMessage.setType(ServerMessage.Type.SPELL_DEFINITIONS);

    const definitionsRepository = {
      reloadAttacks: jest.fn().mockResolvedValue(undefined),
      reloadSpells: jest.fn().mockResolvedValue(undefined),
      createAttackDefinitionsMessage: jest.fn(() => attackMessage),
      createSpellDefinitionsMessage: jest.fn(() => spellMessage),
    };

    const redis = new FakeRedisClient();
    const cm = new ConnectionManager(
      redis as unknown as RedisClientType,
      definitionsRepository as unknown as ConstructorParameters<
        typeof ConnectionManager
      >[1],
    );

    await flushMicrotasks();

    const a = new FakeClient(true);
    const b = new FakeClient(true);
    addFakeClients(cm, a, b);
    // Discard the messages sent during client registration so the assertions
    // observe only what the reload broadcasts.
    a.sentMessages.length = 0;
    b.sentMessages.length = 0;

    return { redis, definitionsRepository, attackMessage, spellMessage, a, b };
  }

  it('reloads attacks and broadcasts them to every client', async () => {
    const { redis, definitionsRepository, attackMessage, a, b } = await setup();

    await redis.pubsub.deliver(
      DEFINITIONS_RELOAD_PUBSUB_KEY,
      JSON.stringify({ type: 'attacks' }),
    );

    expect(definitionsRepository.reloadAttacks).toHaveBeenCalledTimes(1);
    expect(definitionsRepository.reloadSpells).not.toHaveBeenCalled();
    expect(a.sentMessages).toEqual([attackMessage]);
    expect(b.sentMessages).toEqual([attackMessage]);
  });

  it('reloads spells and broadcasts them to every client', async () => {
    const { redis, definitionsRepository, spellMessage, a, b } = await setup();

    await redis.pubsub.deliver(
      DEFINITIONS_RELOAD_PUBSUB_KEY,
      JSON.stringify({ type: 'spells' }),
    );

    expect(definitionsRepository.reloadSpells).toHaveBeenCalledTimes(1);
    expect(definitionsRepository.reloadAttacks).not.toHaveBeenCalled();
    expect(a.sentMessages).toEqual([spellMessage]);
    expect(b.sentMessages).toEqual([spellMessage]);
  });

  it('ignores a malformed notification', async () => {
    const { redis, definitionsRepository, a, b } = await setup();

    await redis.pubsub.deliver(DEFINITIONS_RELOAD_PUBSUB_KEY, 'not json');

    expect(definitionsRepository.reloadAttacks).not.toHaveBeenCalled();
    expect(definitionsRepository.reloadSpells).not.toHaveBeenCalled();
    expect(a.sentMessages).toEqual([]);
    expect(b.sentMessages).toEqual([]);
  });

  it('ignores a notification with an unknown definition type', async () => {
    const { redis, definitionsRepository, a, b } = await setup();

    await redis.pubsub.deliver(
      DEFINITIONS_RELOAD_PUBSUB_KEY,
      JSON.stringify({ type: 'runes' }),
    );

    expect(definitionsRepository.reloadAttacks).not.toHaveBeenCalled();
    expect(definitionsRepository.reloadSpells).not.toHaveBeenCalled();
    expect(a.sentMessages).toEqual([]);
    expect(b.sentMessages).toEqual([]);
  });

  it('does not broadcast when the reload fails', async () => {
    const { redis, definitionsRepository, a, b } = await setup();
    definitionsRepository.reloadAttacks.mockRejectedValue(new Error('s3 down'));

    await redis.pubsub.deliver(
      DEFINITIONS_RELOAD_PUBSUB_KEY,
      JSON.stringify({ type: 'attacks' }),
    );

    expect(definitionsRepository.reloadAttacks).toHaveBeenCalledTimes(1);
    expect(a.sentMessages).toEqual([]);
    expect(b.sentMessages).toEqual([]);
  });
});
