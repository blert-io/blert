import { isTransientDatabaseError } from '../db';
import { EffectEventKind } from '../effects';
import logger from '../log';
import {
  AttemptOutcomeLabel,
  observeDeliveryLatency,
  recordDeliveryAttempt,
  recordDeliveryFailure,
  recordPlanError,
} from '../metrics';
import { DeliveryRow, EffectStore } from './store';
import { DeliveryOutcome, EffectEvent, EffectHandler } from './types';

const DEFAULT_ATTEMPTS = 3;
const DEFAULT_BACKOFF_MS = 30_000;
const MAX_BACKOFF_MS = 15 * 60 * 1000;

/** Number of events within a batch processed concurrently. */
const EVENT_CONCURRENCY = 8;

export type DispatcherOptions = {
  /** Maximum attempts for handlers that don't specify one. */
  defaultAttempts?: number;
  /** Base backoff delay for handlers that don't declare one, in milliseconds. */
  defaultBackoffMs?: number;
  /** Upper bound on backoff between attempts, in milliseconds. */
  maxBackoffMs?: number;
};

/** Runs subscribed handlers for events. */
export class Dispatcher {
  private readonly store: EffectStore;
  private readonly handlersByKind: Map<EffectEventKind, EffectHandler[]>;
  private readonly defaultAttempts: number;
  private readonly defaultBackoffMs: number;
  private readonly maxBackoffMs: number;

  public constructor(
    store: EffectStore,
    handlers: readonly EffectHandler[],
    options: DispatcherOptions = {},
  ) {
    this.store = store;
    this.defaultAttempts = options.defaultAttempts ?? DEFAULT_ATTEMPTS;
    this.defaultBackoffMs = options.defaultBackoffMs ?? DEFAULT_BACKOFF_MS;
    this.maxBackoffMs = options.maxBackoffMs ?? MAX_BACKOFF_MS;
    this.handlersByKind = new Map();

    for (const handler of handlers) {
      for (const kind of handler.kinds) {
        const existing = this.handlersByKind.get(kind);
        if (existing !== undefined) {
          existing.push(handler);
        } else {
          this.handlersByKind.set(kind, [handler]);
        }
      }
    }
  }

  /**
   * Dispatches a batch of events to their subscribed handlers. Every event
   * and handler is attempted regardless of others failing.
   *
   * @param events The events to dispatch.
   * @throws AggregateError if any handler's delivery state could not be
   *     recorded; its `errors` hold each underlying failure.
   */
  public async dispatchBatch(events: EffectEvent[]): Promise<void> {
    if (events.length === 0) {
      return;
    }

    const deliveries = await this.store.loadDeliveries(events.map((e) => e.id));
    const rowsByEvent = new Map<bigint, DeliveryRow[]>();
    for (const row of deliveries) {
      const rows = rowsByEvent.get(row.eventId);
      if (rows !== undefined) {
        rows.push(row);
      } else {
        rowsByEvent.set(row.eventId, [row]);
      }
    }

    const failures: unknown[] = [];
    const queue = [...events];
    const workers = Array.from(
      { length: Math.min(EVENT_CONCURRENCY, queue.length) },
      async () => {
        while (true) {
          const event = queue.shift();
          if (event === undefined) {
            return;
          }
          const errors = await this.dispatchEvent(
            event,
            rowsByEvent.get(event.id) ?? [],
          );
          failures.push(...errors);
        }
      },
    );
    await Promise.all(workers);

    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        `${failures.length} handler task(s) failed`,
      );
    }
  }

  /**
   * Sends an event to every subscribed handler.
   * @returns The failures of any handler tasks which rejected.
   */
  private async dispatchEvent(
    event: EffectEvent,
    deliveries: DeliveryRow[],
  ): Promise<unknown[]> {
    const handlers = this.handlersByKind.get(event.kind) ?? [];
    const results = await Promise.allSettled(
      handlers.map((handler) =>
        this.runHandler(
          handler,
          event,
          deliveries.filter((d) => d.handler === handler.key),
        ),
      ),
    );

    const failures: unknown[] = [];
    results.forEach((result, i) => {
      if (result.status === 'rejected') {
        logger.error('handler_task_error', {
          handler: handlers[i].key,
          eventId: event.id.toString(),
          error:
            result.reason instanceof Error
              ? result.reason.message
              : String(result.reason),
        });
        failures.push(result.reason);
      }
    });
    return failures;
  }

  private async runHandler(
    handler: EffectHandler,
    event: EffectEvent,
    rows: DeliveryRow[],
  ): Promise<void> {
    const budget = handler.attempts ?? this.defaultAttempts;

    if (rows.length === 0) {
      const expired =
        handler.maxAge !== undefined &&
        Date.now() - event.createdAt.getTime() > handler.maxAge;

      let messageKeys: string[];
      if (expired) {
        messageKeys = [];
      } else {
        try {
          messageKeys = await handler.plan(event);
        } catch (e) {
          const transient = isTransientDatabaseError(e);
          logger.error('plan_error', {
            handler: handler.key,
            eventId: event.id.toString(),
            transient,
            error: e instanceof Error ? e.message : String(e),
          });
          recordPlanError(handler.key);
          if (transient) {
            // The event will be retried on a later poll.
            return;
          }
          await this.store.markPlanFailed(event.id, handler.key);
          recordDeliveryFailure(handler.key);
          return;
        }
      }
      await this.store.insertPlan(event.id, handler.key, messageKeys, budget);

      for (const messageKey of messageKeys) {
        await this.deliver(handler, event, messageKey, budget);
      }
      return;
    }

    const due = rows.filter(
      (r) => r.status === 'pending' && r.nextAttemptAt <= new Date(),
    );

    for (const row of due) {
      await this.deliver(handler, event, row.messageKey, row.attemptsRemaining);
    }
  }

  private async deliver(
    handler: EffectHandler,
    event: EffectEvent,
    messageKey: string,
    attemptsRemaining: number,
  ): Promise<void> {
    let outcome: DeliveryOutcome;
    let attemptOutcome: AttemptOutcomeLabel;
    try {
      outcome = await handler.deliver(event, messageKey);
      attemptOutcome = outcome.status;
    } catch (e) {
      logger.error('deliver_error', {
        handler: handler.key,
        eventId: event.id.toString(),
        messageKey,
        error: e instanceof Error ? e.message : String(e),
      });
      outcome = {
        status: 'retry',
        reason: e instanceof Error ? e.message : String(e),
      };
      attemptOutcome = 'error';
    }
    recordDeliveryAttempt(handler.key, attemptOutcome);

    if (outcome.status === 'retry') {
      const delayMs =
        outcome.after ?? this.backoffMs(handler, attemptsRemaining);
      const status = await this.store.scheduleRetry(
        event.id,
        handler.key,
        messageKey,
        delayMs,
      );
      if (status === 'failed') {
        recordDeliveryFailure(handler.key);
        observeDeliveryLatency(
          handler.key,
          Date.now() - event.createdAt.getTime(),
        );
      }
    } else {
      await this.store.markTerminal(
        event.id,
        handler.key,
        messageKey,
        outcome.status,
      );
      if (outcome.status === 'failed') {
        recordDeliveryFailure(handler.key);
      }
      observeDeliveryLatency(
        handler.key,
        Date.now() - event.createdAt.getTime(),
      );
    }
  }

  private backoffMs(handler: EffectHandler, attemptsRemaining: number): number {
    const total = handler.attempts ?? this.defaultAttempts;
    const attempts = Math.max(0, total - attemptsRemaining);
    return Math.min(
      (handler.backoffMs ?? this.defaultBackoffMs) * 2 ** attempts,
      this.maxBackoffMs,
    );
  }
}
