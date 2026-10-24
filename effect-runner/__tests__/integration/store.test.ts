import { Stage } from '@blert/common';
import { beforeEach, describe, expect, it } from '@jest/globals';

import { EffectEventKind } from '../../effects';
import { DeliveryStatus, EffectStore, Subscription } from '../../runner/store';
import { EMPTY_KEY, SINGLE_MESSAGE_KEY } from '../../runner/types';
import { insertEvent, sql, truncateTables } from './setup';

const HANDLER = 'test-handler';
const SUBSCRIPTION: Subscription = {
  kind: EffectEventKind.CHALLENGE_FINISHED,
  handler: HANDLER,
};

const store = new EffectStore(sql);

beforeEach(async () => {
  await truncateTables();
});

async function insertChallengeEvent(createdAt?: Date): Promise<bigint> {
  return await insertEvent(
    EffectEventKind.CHALLENGE_FINISHED,
    { uuid: crypto.randomUUID() },
    createdAt,
  );
}

async function insertStageEvent(createdAt?: Date): Promise<bigint> {
  return await insertEvent(
    EffectEventKind.STAGE_FINISHED,
    { uuid: crypto.randomUUID(), stage: Stage.TOB_MAIDEN, attempt: null },
    createdAt,
  );
}

async function insertDelivery(
  eventId: bigint,
  handler: string,
  status: DeliveryStatus,
  nextAttemptAt: Date = new Date(),
): Promise<void> {
  await sql`
    INSERT INTO effect_deliveries
      (event_id, handler, message_key, status, attempts_remaining, next_attempt_at)
    VALUES
      (${eventId}, ${handler}, ${SINGLE_MESSAGE_KEY}, ${status}, 3, ${nextAttemptAt})
  `;
}

async function markCompleted(
  eventId: bigint,
  completedAt: Date,
): Promise<void> {
  await sql`
    UPDATE effect_events SET completed_at = ${completedAt} WHERE id = ${eventId}
  `;
}

type StoredDelivery = {
  status: DeliveryStatus;
  attemptsRemaining: number;
  nextAttemptAt: Date;
};

type PlannedRow = {
  messageKey: string;
  status: DeliveryStatus;
  attemptsRemaining: number;
};

async function selectPlan(
  eventId: bigint,
  handler: string,
): Promise<PlannedRow[]> {
  return await sql<PlannedRow[]>`
    SELECT
      message_key AS "messageKey",
      status,
      attempts_remaining AS "attemptsRemaining"
    FROM effect_deliveries
    WHERE event_id = ${eventId} AND handler = ${handler}
    ORDER BY message_key
  `;
}

async function selectDelivery(
  eventId: bigint,
  handler: string,
): Promise<StoredDelivery> {
  const [row] = await sql<StoredDelivery[]>`
    SELECT
      status,
      attempts_remaining AS "attemptsRemaining",
      next_attempt_at AS "nextAttemptAt"
    FROM effect_deliveries
    WHERE event_id = ${eventId}
      AND handler = ${handler}
      AND message_key = ${SINGLE_MESSAGE_KEY}
  `;
  return row;
}

describe('registerSubscriptions', () => {
  it('registers each subscription', async () => {
    await store.registerSubscriptions([
      { handler: 'a', kind: EffectEventKind.CHALLENGE_FINISHED },
      { handler: 'a', kind: EffectEventKind.STAGE_FINISHED },
      { handler: 'b', kind: EffectEventKind.STAGE_FINISHED },
    ]);

    const rows = await sql<{ handler: string; kind: number }[]>`
      SELECT handler, kind FROM effect_handlers ORDER BY handler, kind
    `;
    expect(rows).toEqual([
      { handler: 'a', kind: EffectEventKind.CHALLENGE_FINISHED },
      { handler: 'a', kind: EffectEventKind.STAGE_FINISHED },
      { handler: 'b', kind: EffectEventKind.STAGE_FINISHED },
    ]);
  });

  it('keeps the original registration time when re-registered', async () => {
    const original = new Date('2026-09-04T00:00:00Z');
    await store.registerSubscriptions([SUBSCRIPTION]);
    await sql`UPDATE effect_handlers SET registered_at = ${original}`;

    await store.registerSubscriptions([SUBSCRIPTION]);

    const rows = await sql<{ registered_at: Date }[]>`
      SELECT registered_at FROM effect_handlers
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0].registered_at).toEqual(original);
  });
});

describe('pollReadyEvents', () => {
  it('returns an unplanned event for a registered handler', async () => {
    await store.registerSubscriptions([SUBSCRIPTION]);
    const uuid = crypto.randomUUID();
    const id = await insertEvent(EffectEventKind.CHALLENGE_FINISHED, { uuid });

    const work = await store.pollReadyEvents([SUBSCRIPTION]);

    expect(work).toEqual([
      {
        event: {
          id,
          kind: EffectEventKind.CHALLENGE_FINISHED,
          subject: { uuid },
          createdAt: expect.any(Date),
        },
        handlers: [HANDLER],
      },
    ]);
  });

  it('returns nothing for an unregistered handler', async () => {
    await insertChallengeEvent();
    const work = await store.pollReadyEvents([SUBSCRIPTION]);
    expect(work).toEqual([]);
  });

  it('excludes events created before the handler was registered', async () => {
    const before = await insertChallengeEvent(new Date('1999-12-31T23:59:59Z'));
    await store.registerSubscriptions([SUBSCRIPTION]);
    const after = await insertChallengeEvent();

    const work = await store.pollReadyEvents([SUBSCRIPTION]);

    expect(work.map(({ event }) => event.id)).toEqual([after]);
    expect(work.map(({ event }) => event.id)).not.toContain(before);
  });

  it('applies the registration cutoff per subscribed kind', async () => {
    await store.registerSubscriptions([SUBSCRIPTION]);
    await sql`UPDATE effect_handlers SET registered_at = '1999-12-31T23:59:59Z'`;
    const before = await insertStageEvent(new Date('2026-09-06T00:00:00Z'));
    const stageSubscription: Subscription = {
      handler: HANDLER,
      kind: EffectEventKind.STAGE_FINISHED,
    };
    await store.registerSubscriptions([stageSubscription]);
    const after = await insertStageEvent();

    const work = await store.pollReadyEvents([SUBSCRIPTION, stageSubscription]);

    expect(work.map(({ event }) => event.id)).toEqual([after]);
    expect(work.map(({ event }) => event.id)).not.toContain(before);
  });

  it('excludes completed events and those whose deliveries are all finished', async () => {
    await store.registerSubscriptions([SUBSCRIPTION]);
    const id = await insertChallengeEvent();
    await insertDelivery(id, HANDLER, 'delivered');
    // Completed while the handler was disabled.
    const completed = await insertChallengeEvent();
    await markCompleted(completed, new Date());

    const work = await store.pollReadyEvents([SUBSCRIPTION]);
    expect(work).toEqual([]);
  });

  it('returns only events with a pending delivery which is due', async () => {
    await store.registerSubscriptions([SUBSCRIPTION]);
    const due = await insertChallengeEvent();
    await insertDelivery(due, HANDLER, 'pending');
    const notDue = await insertChallengeEvent();
    await insertDelivery(
      notDue,
      HANDLER,
      'pending',
      new Date(Date.now() + 60_000),
    );

    const work = await store.pollReadyEvents([SUBSCRIPTION]);
    expect(work.map(({ event }) => event.id)).toEqual([due]);
  });

  it('lists only the handlers with outstanding work for each event', async () => {
    const finishedSubscription: Subscription = {
      kind: EffectEventKind.CHALLENGE_FINISHED,
      handler: 'finished-handler',
    };
    await store.registerSubscriptions([SUBSCRIPTION, finishedSubscription]);
    const id = await insertChallengeEvent();
    await insertDelivery(id, HANDLER, 'pending');
    await insertDelivery(id, finishedSubscription.handler, 'delivered');

    const work = await store.pollReadyEvents([
      SUBSCRIPTION,
      finishedSubscription,
    ]);

    expect(work.map(({ event, handlers }) => [event.id, handlers])).toEqual([
      [id, [HANDLER]],
    ]);
  });
});

describe('insertPlan', () => {
  it('creates a pending row per message key with the attempt budget', async () => {
    const id = await insertChallengeEvent();

    await store.insertPlan(id, HANDLER, ['a', 'b'], 3);

    expect(await selectPlan(id, HANDLER)).toEqual([
      { messageKey: 'a', status: 'pending', attemptsRemaining: 3 },
      { messageKey: 'b', status: 'pending', attemptsRemaining: 3 },
    ]);
  });

  it('records an empty plan as a skipped sentinel row', async () => {
    const id = await insertChallengeEvent();

    await store.insertPlan(id, HANDLER, [], 3);

    expect(await selectPlan(id, HANDLER)).toEqual([
      { messageKey: EMPTY_KEY, status: 'skipped', attemptsRemaining: 0 },
    ]);
  });

  it('leaves existing rows untouched when re-planned', async () => {
    const id = await insertChallengeEvent();
    await store.insertPlan(id, HANDLER, ['a', 'b'], 3);
    await sql`
      UPDATE effect_deliveries SET status = 'delivered'
      WHERE event_id = ${id} AND message_key = 'a'
    `;

    await store.insertPlan(id, HANDLER, ['a', 'b', 'c'], 5);

    expect(await selectPlan(id, HANDLER)).toEqual([
      { messageKey: 'a', status: 'delivered', attemptsRemaining: 3 },
      { messageKey: 'b', status: 'pending', attemptsRemaining: 3 },
      { messageKey: 'c', status: 'pending', attemptsRemaining: 5 },
    ]);
  });
});

describe('markPlanFailed', () => {
  it('records a failed sentinel row', async () => {
    const id = await insertChallengeEvent();

    await store.markPlanFailed(id, HANDLER);

    expect(await selectPlan(id, HANDLER)).toEqual([
      { messageKey: EMPTY_KEY, status: 'failed', attemptsRemaining: 0 },
    ]);
  });

  it('ignores a previously planned row', async () => {
    const id = await insertChallengeEvent();
    await store.insertPlan(id, HANDLER, [], 3);

    await store.markPlanFailed(id, HANDLER);

    expect(await selectPlan(id, HANDLER)).toEqual([
      { messageKey: EMPTY_KEY, status: 'skipped', attemptsRemaining: 0 },
    ]);
  });
});

describe('scheduleRetry', () => {
  it('reschedules a delivery with retries remaining', async () => {
    const id = await insertChallengeEvent();
    await insertDelivery(id, HANDLER, 'pending', new Date(Date.now() - 60_000));

    const [{ now: before }] = await sql<{ now: Date }[]>`SELECT NOW()`;
    const status = await store.scheduleRetry(
      id,
      HANDLER,
      SINGLE_MESSAGE_KEY,
      60_000,
    );
    const [{ now: after }] = await sql<{ now: Date }[]>`SELECT NOW()`;

    expect(status).toBe('pending');
    const row = await selectDelivery(id, HANDLER);
    expect(row.status).toBe('pending');
    expect(row.attemptsRemaining).toBe(2);
    expect(row.nextAttemptAt.getTime()).toBeGreaterThanOrEqual(
      before.getTime() + 60_000,
    );
    expect(row.nextAttemptAt.getTime()).toBeLessThanOrEqual(
      after.getTime() + 60_000,
    );
  });

  it('fails a delivery on its last attempt', async () => {
    const id = await insertChallengeEvent();
    await insertDelivery(id, HANDLER, 'pending');
    await sql`UPDATE effect_deliveries SET attempts_remaining = 1`;

    const status = await store.scheduleRetry(
      id,
      HANDLER,
      SINGLE_MESSAGE_KEY,
      60_000,
    );

    expect(status).toBe('failed');
    const row = await selectDelivery(id, HANDLER);
    expect(row.status).toBe('failed');
    expect(row.attemptsRemaining).toBe(0);
  });

  it('ignores a delivered item', async () => {
    const id = await insertChallengeEvent();
    await insertDelivery(id, HANDLER, 'delivered');
    const original = await selectDelivery(id, HANDLER);

    const status = await store.scheduleRetry(
      id,
      HANDLER,
      SINGLE_MESSAGE_KEY,
      60_000,
    );

    expect(status).toBeNull();
    expect(await selectDelivery(id, HANDLER)).toEqual(original);
  });

  it('returns null for a delivery which does not exist', async () => {
    const id = await insertChallengeEvent();

    const status = await store.scheduleRetry(
      id,
      HANDLER,
      SINGLE_MESSAGE_KEY,
      60_000,
    );

    expect(status).toBeNull();
  });
});

describe('markTerminal', () => {
  it.each(['delivered', 'failed', 'skipped'] as const)(
    'marks a pending delivery as %s',
    async (status) => {
      const id = await insertChallengeEvent();
      await insertDelivery(id, HANDLER, 'pending');

      await store.markTerminal(id, HANDLER, SINGLE_MESSAGE_KEY, status);

      expect((await selectDelivery(id, HANDLER)).status).toBe(status);
    },
  );

  it('ignores a previously terminated delivery', async () => {
    const id = await insertChallengeEvent();
    await insertDelivery(id, HANDLER, 'failed');
    const original = await selectDelivery(id, HANDLER);

    await store.markTerminal(id, HANDLER, SINGLE_MESSAGE_KEY, 'delivered');

    expect(await selectDelivery(id, HANDLER)).toEqual(original);
  });
});

describe('loadDeliveries', () => {
  it('returns every delivery row for the given events', async () => {
    const first = await insertChallengeEvent();
    await store.insertPlan(first, HANDLER, ['a', 'b'], 3);
    const second = await insertChallengeEvent();
    await insertDelivery(second, HANDLER, 'delivered');

    const rows = await store.loadDeliveries([first, second]);

    expect(rows).toHaveLength(3);
    expect(rows).toEqual(
      expect.arrayContaining([
        {
          eventId: first,
          handler: HANDLER,
          messageKey: 'a',
          status: 'pending',
          attemptsRemaining: 3,
          nextAttemptAt: expect.any(Date),
        },
        {
          eventId: first,
          handler: HANDLER,
          messageKey: 'b',
          status: 'pending',
          attemptsRemaining: 3,
          nextAttemptAt: expect.any(Date),
        },
        {
          eventId: second,
          handler: HANDLER,
          messageKey: SINGLE_MESSAGE_KEY,
          status: 'delivered',
          attemptsRemaining: 3,
          nextAttemptAt: expect.any(Date),
        },
      ]),
    );
  });

  it('excludes rows belonging to other events', async () => {
    const wanted = await insertChallengeEvent();
    await insertDelivery(wanted, HANDLER, 'pending');
    const other = await insertChallengeEvent();
    await insertDelivery(other, HANDLER, 'pending');

    const rows = await store.loadDeliveries([wanted]);

    expect(rows.map((r) => r.eventId)).toEqual([wanted]);
  });
});

describe('oldestOutstanding', () => {
  const REGISTERED_AT = new Date('2026-01-01T00:00:00Z');
  const FAR_FUTURE = new Date('2038-01-19T03:14:08Z');

  async function registerHandler(): Promise<void> {
    await store.registerSubscriptions([SUBSCRIPTION]);
    await sql`UPDATE effect_handlers SET registered_at = ${REGISTERED_AT}`;
  }

  it('returns null when no work is outstanding', async () => {
    await registerHandler();
    const id = await insertChallengeEvent();
    await insertDelivery(id, HANDLER, 'delivered');

    expect(await store.oldestOutstanding([SUBSCRIPTION])).toBeNull();
  });

  it('returns the creation time of the oldest event with outstanding work', async () => {
    await registerHandler();
    const oldest = new Date('2026-02-01T00:00:00Z');
    const waiting = await insertChallengeEvent(oldest);
    await insertDelivery(waiting, HANDLER, 'pending', FAR_FUTURE);
    await insertChallengeEvent(new Date('2026-03-01T00:00:00Z'));

    expect(await store.oldestOutstanding([SUBSCRIPTION])).toEqual(oldest);
  });

  it('ignores finished events, completed events and events before registration', async () => {
    await registerHandler();
    await insertChallengeEvent(new Date('2025-12-01T00:00:00Z'));
    const finished = await insertChallengeEvent(
      new Date('2026-02-01T00:00:00Z'),
    );
    await insertDelivery(finished, HANDLER, 'delivered');
    // Completed while the handler was disabled.
    const completedAt = new Date('2026-02-15T00:00:00Z');
    const completed = await insertChallengeEvent(completedAt);
    await markCompleted(completed, completedAt);
    const outstanding = new Date('2026-03-01T00:00:00Z');
    await insertChallengeEvent(outstanding);

    expect(await store.oldestOutstanding([SUBSCRIPTION])).toEqual(outstanding);
  });
});

describe('completeEvents', () => {
  const REGISTERED_AT = new Date('2026-08-15T00:00:00Z');
  const FAR_FUTURE = new Date('2038-01-19T03:14:08Z');

  async function registerHandler(): Promise<void> {
    await store.registerSubscriptions([SUBSCRIPTION]);
    await sql`UPDATE effect_handlers SET registered_at = ${REGISTERED_AT}`;
  }

  it('completes events without outstanding work', async () => {
    // A handler that previously existed and did work but was removed.
    await store.registerSubscriptions([
      { kind: EffectEventKind.CHALLENGE_FINISHED, handler: 'retired-handler' },
    ]);
    await registerHandler();

    const earlierCompletion = new Date('2026-08-21T00:00:00Z');
    const earlier = await insertChallengeEvent(
      new Date('2026-08-20T00:00:00Z'),
    );
    await insertDelivery(earlier, HANDLER, 'delivered');
    await markCompleted(earlier, earlierCompletion);
    const delivered = await insertChallengeEvent();
    await insertDelivery(delivered, HANDLER, 'delivered');
    const failed = await insertChallengeEvent();
    await insertDelivery(failed, HANDLER, 'failed');
    const waiting = await insertChallengeEvent();
    await insertDelivery(waiting, HANDLER, 'pending', FAR_FUTURE);
    const unplanned = await insertChallengeEvent();
    const preregistration = await insertChallengeEvent(
      new Date('2026-08-01T00:00:00Z'),
    );
    const unsubscribed = await insertStageEvent();
    const retired = await insertChallengeEvent();
    await insertDelivery(retired, HANDLER, 'delivered');
    await insertDelivery(retired, 'retired-handler', 'pending');

    await store.completeEvents([SUBSCRIPTION]);

    const completions = await sql<{ id: bigint; completedAt: Date | null }[]>`
      SELECT id, completed_at AS "completedAt" FROM effect_events ORDER BY id
    `;
    expect(completions).toEqual([
      { id: earlier, completedAt: earlierCompletion },
      { id: delivered, completedAt: expect.any(Date) },
      { id: failed, completedAt: expect.any(Date) },
      { id: waiting, completedAt: null },
      { id: unplanned, completedAt: null },
      { id: preregistration, completedAt: expect.any(Date) },
      { id: unsubscribed, completedAt: expect.any(Date) },
      { id: retired, completedAt: expect.any(Date) },
    ]);
  });

  it('does nothing when called without subscriptions', async () => {
    await registerHandler();
    const id = await insertChallengeEvent();
    await insertDelivery(id, HANDLER, 'delivered');

    await store.completeEvents([]);

    const completions = await sql<{ id: bigint; completedAt: Date | null }[]>`
      SELECT id, completed_at AS "completedAt" FROM effect_events ORDER BY id
    `;
    expect(completions).toEqual([{ id, completedAt: null }]);
  });
});

describe('sweepEvents', () => {
  const CUTOFF = new Date('2026-09-08T00:00:00Z');
  const BEFORE_CUTOFF = new Date('2026-09-05T00:00:00Z');
  const AFTER_CUTOFF = new Date('2026-09-14T00:00:00Z');

  it('deletes completed events before the cutoff without failures', async () => {
    const swept = await insertChallengeEvent(BEFORE_CUTOFF);
    await insertDelivery(swept, HANDLER, 'delivered');
    await markCompleted(swept, BEFORE_CUTOFF);
    const recent = await insertChallengeEvent(AFTER_CUTOFF);
    await insertDelivery(recent, HANDLER, 'delivered');
    await markCompleted(recent, AFTER_CUTOFF);
    const incomplete = await insertChallengeEvent(BEFORE_CUTOFF);
    const failed = await insertChallengeEvent(BEFORE_CUTOFF);
    await insertDelivery(failed, HANDLER, 'failed');
    await markCompleted(failed, BEFORE_CUTOFF);

    expect(await store.sweepEvents(CUTOFF)).toBe(1);

    const events = await sql<{ id: bigint }[]>`
      SELECT id FROM effect_events ORDER BY id
    `;
    expect(events.map((row) => row.id)).toEqual([recent, incomplete, failed]);
    const deliveries = await sql<{ eventId: bigint }[]>`
      SELECT event_id AS "eventId" FROM effect_deliveries ORDER BY event_id
    `;
    expect(deliveries.map((row) => row.eventId)).toEqual([recent, failed]);
  });
});
