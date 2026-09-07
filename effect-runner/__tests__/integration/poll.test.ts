import { Stage } from '@blert/common';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { ALL_EFFECT_EVENT_KINDS, EffectEventKind } from '../../effects';
import { subscriptionsOf } from '../../handlers';
import {
  DeliveryRow,
  Dispatcher,
  EffectHandler,
  EffectStore,
  Poller,
  SINGLE_MESSAGE_KEY,
  Subscription,
} from '../../runner';
import { insertEvent, sql, truncateTables } from './setup';

const HANDLER = 'e2e';
const POLL_INTERVAL_MS = 10;
const DEADLINE_MS = 2_000;

const store = new EffectStore(sql);

beforeEach(async () => {
  await truncateTables();
});

type Fixture = {
  deliver: jest.Mock<EffectHandler['deliver']>;
  subscriptions: Subscription[];
  poller: Poller;
};

async function withPoller(
  test: (fixture: Fixture) => Promise<void>,
): Promise<void> {
  const deliver = jest
    .fn<EffectHandler['deliver']>()
    .mockResolvedValue({ status: 'delivered' });
  const handler: EffectHandler = {
    key: HANDLER,
    kinds: ALL_EFFECT_EVENT_KINDS,
    plan: jest
      .fn<EffectHandler['plan']>()
      .mockResolvedValue([SINGLE_MESSAGE_KEY]),
    deliver,
  };

  const subscriptions = subscriptionsOf([handler]);
  await store.registerSubscriptions(subscriptions);

  const poller = new Poller(
    store,
    new Dispatcher(store, [handler]),
    subscriptions,
    POLL_INTERVAL_MS,
  );

  try {
    await test({ deliver, subscriptions, poller });
  } finally {
    await poller.stop();
  }
}

async function insertChallengeEvent(): Promise<bigint> {
  return await insertEvent(EffectEventKind.CHALLENGE_FINISHED, {
    uuid: crypto.randomUUID(),
  });
}

async function insertStageEvent(stage: Stage): Promise<bigint> {
  return await insertEvent(EffectEventKind.STAGE_FINISHED, {
    uuid: crypto.randomUUID(),
    stage,
    attempt: null,
  });
}

async function until(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + DEADLINE_MS;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error('Timed out waiting for condition');
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
}

type SettledRow = Omit<DeliveryRow, 'nextAttemptAt'>;

async function fetchRows(eventIds: bigint[]): Promise<Set<SettledRow>> {
  const rows = await store.loadDeliveries(eventIds);
  const settled = rows.map(
    ({ eventId, handler, messageKey, status, attemptsRemaining }) => ({
      eventId,
      handler,
      messageKey,
      status,
      attemptsRemaining,
    }),
  );
  return new Set(settled);
}

describe('Poller', () => {
  it('drains events arriving across ticks', () =>
    withPoller(async ({ deliver, subscriptions, poller }) => {
      const first = await insertStageEvent(Stage.TOB_MAIDEN);
      const second = await insertStageEvent(Stage.TOB_BLOAT);

      poller.start();
      await until(() => deliver.mock.calls.length === 2);

      const third = await insertChallengeEvent();
      await until(() => deliver.mock.calls.length === 3);
      await poller.stop();

      const ids = deliver.mock.calls.map(([event]) => event.id);
      const batch = new Set(ids.slice(0, 2));
      expect(batch).toEqual(new Set([first, second]));
      expect(ids[2]).toBe(third);

      const rows = await fetchRows([first, second, third]);
      expect(rows).toEqual(
        new Set([
          {
            eventId: first,
            handler: HANDLER,
            messageKey: SINGLE_MESSAGE_KEY,
            status: 'delivered',
            attemptsRemaining: 3,
          },
          {
            eventId: second,
            handler: HANDLER,
            messageKey: SINGLE_MESSAGE_KEY,
            status: 'delivered',
            attemptsRemaining: 3,
          },
          {
            eventId: third,
            handler: HANDLER,
            messageKey: SINGLE_MESSAGE_KEY,
            status: 'delivered',
            attemptsRemaining: 3,
          },
        ]),
      );
      expect(await store.pollReadyEvents(subscriptions)).toEqual([]);
      expect(await store.oldestOutstanding(subscriptions)).toBeNull();
    }));

  it('redelivers an immediate retry on its next tick', () =>
    withPoller(async ({ deliver, poller }) => {
      deliver
        .mockResolvedValueOnce({ status: 'retry', after: 0, reason: 'busy' })
        .mockResolvedValueOnce({ status: 'delivered' });
      const id = await insertChallengeEvent();

      poller.start();
      await until(() => deliver.mock.calls.length === 2);
      await poller.stop();

      const calls = deliver.mock.calls.map(([event, key]) => [event.id, key]);
      expect(calls).toEqual([
        [id, SINGLE_MESSAGE_KEY],
        [id, SINGLE_MESSAGE_KEY],
      ]);

      const rows = await fetchRows([id]);
      expect(rows).toEqual(
        new Set([
          {
            eventId: id,
            handler: HANDLER,
            messageKey: SINGLE_MESSAGE_KEY,
            status: 'delivered',
            attemptsRemaining: 2,
          },
        ]),
      );
    }));
});
