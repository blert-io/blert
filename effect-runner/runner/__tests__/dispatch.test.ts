import { Stage } from '@blert/common';
import { describe, expect, it, jest } from '@jest/globals';
import postgres from 'postgres';

import { EffectEventKind } from '../../effects';
import { Dispatcher, DispatcherOptions } from '../dispatch';
import { DeliveryRow, EffectStore } from '../store';
import { EffectEvent, EffectHandler } from '../types';

function makeStore() {
  return {
    loadDeliveries: jest
      .fn<EffectStore['loadDeliveries']>()
      .mockResolvedValue([]),
    insertPlan: jest
      .fn<EffectStore['insertPlan']>()
      .mockResolvedValue(undefined),
    markPlanFailed: jest
      .fn<EffectStore['markPlanFailed']>()
      .mockResolvedValue(undefined),
    markTerminal: jest
      .fn<EffectStore['markTerminal']>()
      .mockResolvedValue(undefined),
    scheduleRetry: jest
      .fn<EffectStore['scheduleRetry']>()
      .mockResolvedValue('pending'),
  };
}

type FakeStore = ReturnType<typeof makeStore>;

function makeDispatcher(
  store: FakeStore,
  handlers: EffectHandler[],
  options: DispatcherOptions = {},
): Dispatcher {
  return new Dispatcher(store as unknown as EffectStore, handlers, options);
}

function makeHandler(
  kind: EffectEventKind,
  overrides: Partial<EffectHandler> = {},
): EffectHandler {
  return {
    key: 'test.handler',
    kinds: [kind],
    plan: jest.fn<EffectHandler['plan']>().mockResolvedValue(['*']),
    deliver: jest
      .fn<EffectHandler['deliver']>()
      .mockResolvedValue({ status: 'delivered' }),
    ...overrides,
  };
}

function makeEvent(
  kind: EffectEventKind,
  overrides: Partial<Pick<EffectEvent, 'id' | 'createdAt'>> = {},
): EffectEvent {
  const uuid = crypto.randomUUID();
  const event: EffectEvent =
    kind === EffectEventKind.CHALLENGE_FINISHED
      ? { id: 1n, kind, subject: { uuid }, createdAt: new Date() }
      : {
          id: 1n,
          kind,
          subject: { uuid, stage: Stage.TOB_MAIDEN, attempt: null },
          createdAt: new Date(),
        };
  return { ...event, ...overrides };
}

function makePlan(messageKeys: string[]) {
  return jest.fn<EffectHandler['plan']>().mockResolvedValue(messageKeys);
}

function makeDeliver() {
  return jest
    .fn<EffectHandler['deliver']>()
    .mockResolvedValue({ status: 'delivered' });
}

function makePostgresError(code: string): Error {
  const PostgresError = postgres.PostgresError as unknown as new (fields: {
    code: string;
    message: string;
  }) => Error;
  return new PostgresError({ code, message: `sqlstate ${code}` });
}

function makeRow(overrides: Partial<DeliveryRow> = {}): DeliveryRow {
  return {
    eventId: 1n,
    handler: 'test.handler',
    messageKey: '*',
    status: 'pending',
    attemptsRemaining: 3,
    nextAttemptAt: new Date(0),
    ...overrides,
  };
}

describe('backoff', () => {
  function retryDelay(store: FakeStore, call = 0): number {
    return store.scheduleRetry.mock.calls[call][3];
  }

  it('retries after the after duration when specified', async () => {
    const store = makeStore();
    const handler = makeHandler(EffectEventKind.CHALLENGE_FINISHED, {
      backoffMs: 100,
    });
    (handler.deliver as jest.Mock).mockReturnValue(
      Promise.resolve({ status: 'retry', after: 1_234, reason: 'rate limit' }),
    );
    const event = makeEvent(EffectEventKind.CHALLENGE_FINISHED);

    await makeDispatcher(store, [handler]).dispatchBatch([event]);

    expect(store.scheduleRetry).toHaveBeenCalledWith(
      event.id,
      handler.key,
      '*',
      1_234,
    );
  });

  it("waits for a handler's backoff before retrying", async () => {
    const store = makeStore();
    const handler = makeHandler(EffectEventKind.CHALLENGE_FINISHED, {
      backoffMs: 100,
    });
    (handler.deliver as jest.Mock).mockReturnValue(
      Promise.resolve({ status: 'retry', reason: 'r' }),
    );

    await makeDispatcher(store, [handler]).dispatchBatch([
      makeEvent(EffectEventKind.CHALLENGE_FINISHED),
    ]);

    expect(retryDelay(store)).toBe(100);
  });

  it('falls back to the default backoff', async () => {
    const store = makeStore();
    const handler = makeHandler(EffectEventKind.CHALLENGE_FINISHED);
    (handler.deliver as jest.Mock).mockReturnValue(
      Promise.resolve({ status: 'retry', reason: 'r' }),
    );

    await makeDispatcher(store, [handler], {
      defaultBackoffMs: 50,
    }).dispatchBatch([makeEvent(EffectEventKind.CHALLENGE_FINISHED)]);

    expect(retryDelay(store)).toBe(50);
  });

  it('monotonically advances backoff time up to the limit', async () => {
    const handler = makeHandler(EffectEventKind.CHALLENGE_FINISHED, {
      attempts: 6,
      backoffMs: 100,
    });
    (handler.deliver as jest.Mock).mockReturnValue(
      Promise.resolve({ status: 'retry', reason: 'r' }),
    );

    const delays: number[] = [];
    for (let remaining = 6; remaining >= 1; remaining--) {
      const store = makeStore();
      store.loadDeliveries.mockResolvedValue([
        makeRow({ attemptsRemaining: remaining }),
      ]);
      await makeDispatcher(store, [handler], {
        maxBackoffMs: 400,
      }).dispatchBatch([makeEvent(EffectEventKind.CHALLENGE_FINISHED)]);
      delays.push(retryDelay(store));
    }

    for (let i = 1; i < delays.length; i++) {
      expect(delays[i]).toBeGreaterThanOrEqual(delays[i - 1]);
    }
    expect(Math.max(...delays)).toBe(400);
    expect(delays[delays.length - 1]).toBe(400);
  });
});

describe('outcomes', () => {
  it.each(['delivered', 'skipped', 'failed'] as const)(
    'marks the delivery terminal on a %s outcome',
    async (status) => {
      const store = makeStore();
      const handler = makeHandler(EffectEventKind.CHALLENGE_FINISHED);
      (handler.deliver as jest.Mock).mockReturnValue(
        Promise.resolve({ status, reason: 'r' }),
      );
      const event = makeEvent(EffectEventKind.CHALLENGE_FINISHED);

      await makeDispatcher(store, [handler]).dispatchBatch([event]);

      expect(store.markTerminal).toHaveBeenCalledWith(
        event.id,
        handler.key,
        '*',
        status,
      );
      expect(store.scheduleRetry).not.toHaveBeenCalled();
    },
  );

  it('leaves a retry outcome pending', async () => {
    const store = makeStore();
    const handler = makeHandler(EffectEventKind.CHALLENGE_FINISHED);
    (handler.deliver as jest.Mock).mockReturnValue(
      Promise.resolve({ status: 'retry', reason: 'r' }),
    );
    const event = makeEvent(EffectEventKind.CHALLENGE_FINISHED);

    await makeDispatcher(store, [handler]).dispatchBatch([event]);

    expect(store.scheduleRetry).toHaveBeenCalledTimes(1);
    expect(store.markTerminal).not.toHaveBeenCalled();
  });

  it('schedules a retry when deliver throws', async () => {
    const store = makeStore();
    const handler = makeHandler(EffectEventKind.CHALLENGE_FINISHED);
    (handler.deliver as jest.Mock).mockReturnValue(
      Promise.reject(new Error('discord fell over')),
    );

    await makeDispatcher(store, [handler]).dispatchBatch([
      makeEvent(EffectEventKind.CHALLENGE_FINISHED),
    ]);

    expect(store.scheduleRetry).toHaveBeenCalledTimes(1);
    expect(store.markTerminal).not.toHaveBeenCalled();
  });
});

describe('planning', () => {
  it('plans an unplanned event and delivers each planned message', async () => {
    const store = makeStore();
    const plan = makePlan(['a', 'b']);
    const deliver = makeDeliver();
    const handler = makeHandler(EffectEventKind.CHALLENGE_FINISHED, {
      attempts: 5,
      plan,
      deliver,
    });
    const event = makeEvent(EffectEventKind.CHALLENGE_FINISHED);

    await makeDispatcher(store, [handler]).dispatchBatch([event]);

    expect(plan).toHaveBeenCalledTimes(1);
    expect(store.insertPlan).toHaveBeenCalledWith(
      event.id,
      handler.key,
      ['a', 'b'],
      5,
    );
    expect(deliver).toHaveBeenCalledTimes(2);
    expect(deliver).toHaveBeenCalledWith(event, 'a');
    expect(deliver).toHaveBeenCalledWith(event, 'b');
    expect(store.markTerminal).toHaveBeenCalledTimes(2);
  });

  it('records an empty plan without any actions', async () => {
    const store = makeStore();
    const deliver = makeDeliver();
    const handler = makeHandler(EffectEventKind.CHALLENGE_FINISHED, {
      plan: makePlan([]),
      deliver,
    });
    const event = makeEvent(EffectEventKind.CHALLENGE_FINISHED);

    await makeDispatcher(store, [handler]).dispatchBatch([event]);

    expect(store.insertPlan).toHaveBeenCalledWith(
      event.id,
      handler.key,
      [],
      expect.any(Number),
    );
    expect(deliver).not.toHaveBeenCalled();
  });

  it('skips an event past its maxAge', async () => {
    const store = makeStore();
    const plan = makePlan(['*']);
    const deliver = makeDeliver();
    const handler = makeHandler(EffectEventKind.CHALLENGE_FINISHED, {
      maxAge: 1_000,
      plan,
      deliver,
    });
    const event = makeEvent(EffectEventKind.CHALLENGE_FINISHED, {
      createdAt: new Date(Date.now() - 5_000),
    });

    await makeDispatcher(store, [handler]).dispatchBatch([event]);

    expect(plan).not.toHaveBeenCalled();
    expect(store.insertPlan).toHaveBeenCalledWith(
      event.id,
      handler.key,
      [],
      expect.any(Number),
    );
    expect(deliver).not.toHaveBeenCalled();
  });

  it('does not re-plan an event which has existing delivery rows', async () => {
    const store = makeStore();
    store.loadDeliveries.mockResolvedValue([makeRow({ status: 'delivered' })]);
    const plan = makePlan(['*']);
    const deliver = makeDeliver();
    const handler = makeHandler(EffectEventKind.CHALLENGE_FINISHED, {
      plan,
      deliver,
    });

    await makeDispatcher(store, [handler]).dispatchBatch([
      makeEvent(EffectEventKind.CHALLENGE_FINISHED),
    ]);

    expect(plan).not.toHaveBeenCalled();
    expect(store.insertPlan).not.toHaveBeenCalled();
    expect(deliver).not.toHaveBeenCalled();
  });

  it('delivers only pending rows which are due in their batch', async () => {
    const store = makeStore();
    store.loadDeliveries.mockResolvedValue([
      makeRow({ messageKey: 'due' }),
      makeRow({
        messageKey: 'backing-off',
        nextAttemptAt: new Date(Date.now() + 60_000),
      }),
      makeRow({ messageKey: 'done', status: 'delivered' }),
    ]);
    const deliver = makeDeliver();
    const handler = makeHandler(EffectEventKind.CHALLENGE_FINISHED, {
      deliver,
    });
    const event = makeEvent(EffectEventKind.CHALLENGE_FINISHED);

    await makeDispatcher(store, [handler]).dispatchBatch([event]);

    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver).toHaveBeenCalledWith(event, 'due');
  });

  it('ignores events of unsubscribed kinds', async () => {
    const store = makeStore();
    const plan = makePlan(['*']);
    const handler = makeHandler(EffectEventKind.STAGE_FINISHED, { plan });

    await makeDispatcher(store, [handler]).dispatchBatch([
      makeEvent(EffectEventKind.CHALLENGE_FINISHED),
    ]);

    expect(plan).not.toHaveBeenCalled();
    expect(store.insertPlan).not.toHaveBeenCalled();
  });

  it('isolates a handler throwing in its plan and fails it', async () => {
    const store = makeStore();
    const brokenDeliver = makeDeliver();
    const broken = makeHandler(EffectEventKind.CHALLENGE_FINISHED, {
      key: 'broken',
      plan: jest
        .fn<EffectHandler['plan']>()
        .mockRejectedValue(new Error('boom')),
      deliver: brokenDeliver,
    });
    const healthyDeliver = makeDeliver();
    const healthy = makeHandler(EffectEventKind.CHALLENGE_FINISHED, {
      key: 'healthy',
      deliver: healthyDeliver,
    });
    const event = makeEvent(EffectEventKind.CHALLENGE_FINISHED);

    await makeDispatcher(store, [broken, healthy]).dispatchBatch([event]);

    expect(store.markPlanFailed).toHaveBeenCalledTimes(1);
    expect(store.markPlanFailed).toHaveBeenCalledWith(event.id, 'broken');
    expect(store.insertPlan).toHaveBeenCalledTimes(1);
    expect(store.insertPlan).toHaveBeenCalledWith(
      event.id,
      'healthy',
      ['*'],
      expect.any(Number),
    );
    expect(healthyDeliver).toHaveBeenCalledTimes(1);
    expect(brokenDeliver).not.toHaveBeenCalled();
  });

  it('leaves an event unplanned when plan fails transiently', async () => {
    const store = makeStore();
    const deliver = makeDeliver();
    const handler = makeHandler(EffectEventKind.CHALLENGE_FINISHED, {
      plan: jest
        .fn<EffectHandler['plan']>()
        .mockRejectedValue(makePostgresError('57014')),
      deliver,
    });
    const event = makeEvent(EffectEventKind.CHALLENGE_FINISHED);

    await makeDispatcher(store, [handler]).dispatchBatch([event]);

    expect(store.markPlanFailed).not.toHaveBeenCalled();
    expect(store.insertPlan).not.toHaveBeenCalled();
    expect(deliver).not.toHaveBeenCalled();
  });
});

describe('store failures', () => {
  it('finishes the batch, then rejects with every failure', async () => {
    const store = makeStore();
    const dbError = new Error('connection closed');
    store.insertPlan.mockRejectedValueOnce(dbError);
    const deliver = makeDeliver();
    const handler = makeHandler(EffectEventKind.CHALLENGE_FINISHED, {
      deliver,
    });
    const first = makeEvent(EffectEventKind.CHALLENGE_FINISHED, { id: 1n });
    const second = makeEvent(EffectEventKind.CHALLENGE_FINISHED, { id: 2n });

    const batch = makeDispatcher(store, [handler]).dispatchBatch([
      first,
      second,
    ]);

    await expect(batch).rejects.toThrow(AggregateError);
    await expect(batch).rejects.toMatchObject({ errors: [dbError] });
    expect(store.insertPlan).toHaveBeenCalledTimes(2);
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver).toHaveBeenCalledWith(second, '*');
  });
});
