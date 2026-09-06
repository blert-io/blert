import { Sql } from '../db';
import { EffectEventKind } from '../effects';
import { EMPTY_KEY, EffectEvent } from './types';

/** A single subscription to an event.  */
export type Subscription = {
  kind: EffectEventKind;
  handler: string;
};

export type DeliveryStatus = 'pending' | 'delivered' | 'failed' | 'skipped';

/** A row of the `effect_deliveries` table. */
export type DeliveryRow = {
  eventId: bigint;
  handler: string;
  messageKey: string;
  status: DeliveryStatus;
  attemptsRemaining: number;
  nextAttemptAt: Date;
};

const BATCH_LIMIT = 100;

export class EffectStore {
  private readonly sql: Sql;

  public constructor(sql: Sql) {
    this.sql = sql;
  }

  /**
   * Registers each of the configured subscriptions.
   * @param subscriptions Every handler and kind it subscribes to.
   */
  public async registerSubscriptions(
    subscriptions: Subscription[],
  ): Promise<void> {
    if (subscriptions.length === 0) {
      return;
    }
    await this.sql`
      INSERT INTO effect_handlers ${this.sql(subscriptions, 'handler', 'kind')}
      ON CONFLICT DO NOTHING
    `;
  }

  /**
   * Fetches a batch of events which have outstanding work for at least one
   * of the given subscriptions. Work can come from either new events, or
   * partially processed previous ones.
   *
   * @param subscriptions The event subscriptions to consider.
   * @returns The events, oldest first.
   */
  public async pollReadyEvents(
    subscriptions: Subscription[],
  ): Promise<EffectEvent[]> {
    if (subscriptions.length === 0) {
      return [];
    }

    const kinds = subscriptions.map((s) => s.kind);
    const handlers = subscriptions.map((s) => s.handler);

    return await this.sql<EffectEvent[]>`
      SELECT
        e.id,
        e.kind,
        e.subject,
        e.created_at AS "createdAt"
      FROM effect_events e
      WHERE EXISTS (
        SELECT 1
        FROM unnest(
          ${kinds}::smallint[],
          ${handlers}::text[]
        ) AS sub(kind, handler)
        JOIN effect_handlers h
          ON h.handler = sub.handler AND h.kind = sub.kind
        WHERE sub.kind = e.kind
          AND e.created_at >= h.registered_at
          AND (
            NOT EXISTS (
              SELECT 1 FROM effect_deliveries d
              WHERE d.event_id = e.id AND d.handler = sub.handler
            )
            OR EXISTS (
              SELECT 1 FROM effect_deliveries d
              WHERE d.event_id = e.id
                AND d.handler = sub.handler
                AND d.status = 'pending'
                AND d.next_attempt_at <= NOW()
            )
          )
      )
      ORDER BY e.id
      LIMIT ${BATCH_LIMIT}
    `;
  }

  /**
   * Finds the creation time of the oldest event with outstanding work for at
   * least one of the given subscriptions.
   *
   * @param subscriptions The event subscriptions to consider.
   * @returns The event's creation time, or null if no work is outstanding.
   */
  public async oldestOutstanding(
    subscriptions: Subscription[],
  ): Promise<Date | null> {
    if (subscriptions.length === 0) {
      return null;
    }

    const kinds = subscriptions.map((s) => s.kind);
    const handlers = subscriptions.map((s) => s.handler);

    const rows = await this.sql<{ createdAt: Date | null }[]>`
      SELECT MIN(e.created_at) AS "createdAt"
      FROM effect_events e
      WHERE EXISTS (
        SELECT 1
        FROM unnest(
          ${kinds}::smallint[],
          ${handlers}::text[]
        ) AS sub(kind, handler)
        JOIN effect_handlers h
          ON h.handler = sub.handler AND h.kind = sub.kind
        WHERE sub.kind = e.kind
          AND e.created_at >= h.registered_at
          AND (
            NOT EXISTS (
              SELECT 1 FROM effect_deliveries d
              WHERE d.event_id = e.id AND d.handler = sub.handler
            )
            OR EXISTS (
              SELECT 1 FROM effect_deliveries d
              WHERE d.event_id = e.id
                AND d.handler = sub.handler
                AND d.status = 'pending'
            )
          )
      )
    `;

    return rows[0]?.createdAt ?? null;
  }

  /**
   * Fetches every delivery row for the given events.
   *
   * @param eventIds IDs of the events.
   * @returns The delivery rows, in no particular order.
   */
  public async loadDeliveries(eventIds: bigint[]): Promise<DeliveryRow[]> {
    if (eventIds.length === 0) {
      return [];
    }

    return await this.sql<DeliveryRow[]>`
      SELECT
        event_id AS "eventId",
        handler,
        message_key AS "messageKey",
        status,
        attempts_remaining AS "attemptsRemaining",
        next_attempt_at AS "nextAttemptAt"
      FROM effect_deliveries
      WHERE event_id = ANY(${this.sql.array(eventIds)})
    `;
  }

  /**
   * Records the result of planning an event for a handler, creating a pending
   * delivery row per message key. An empty `messageKeys` list indicates that
   * the handler has no work to do for the event.
   *
   * Keys that are already tracked are left untouched.
   *
   * @param eventId ID of the planned event.
   * @param handler ID of the handler which planned it.
   * @param messageKeys The message keys to deliver.
   * @param attempts The handler's delivery attempt budget.
   */
  public async insertPlan(
    eventId: bigint,
    handler: string,
    messageKeys: string[],
    attempts: number,
  ): Promise<void> {
    const rows =
      messageKeys.length > 0
        ? messageKeys.map((key) => ({
            event_id: eventId,
            handler,
            message_key: key,
            status: 'pending',
            attempts_remaining: attempts,
          }))
        : [
            {
              event_id: eventId,
              handler,
              message_key: EMPTY_KEY,
              status: 'skipped',
              attempts_remaining: 0,
            },
          ];

    await this.sql`
      INSERT INTO effect_deliveries ${this.sql(rows)}
      ON CONFLICT DO NOTHING
    `;
  }

  /**
   * Records that a handler could not plan an event and will not try again.
   * Does nothing if the handler has already planned the event.
   *
   * @param eventId ID of the event.
   * @param handler ID of the handler which failed to plan it.
   */
  public async markPlanFailed(eventId: bigint, handler: string): Promise<void> {
    await this.sql`
      INSERT INTO effect_deliveries
        (event_id, handler, message_key, status, attempts_remaining)
      VALUES (${eventId}, ${handler}, ${EMPTY_KEY}, 'failed', 0)
      ON CONFLICT DO NOTHING
    `;
  }

  /**
   * Marks a pending delivery with its terminal status.
   * Does nothing if the delivery is already finished.
   *
   * @param eventId ID of the event.
   * @param handler Handler which owns the delivery.
   * @param messageKey Message key of the delivery.
   * @param status The terminal status.
   */
  public async markTerminal(
    eventId: bigint,
    handler: string,
    messageKey: string,
    status: 'delivered' | 'failed' | 'skipped',
  ): Promise<void> {
    await this.sql`
      UPDATE effect_deliveries
      SET status = ${status}
      WHERE event_id = ${eventId}
        AND handler = ${handler}
        AND message_key = ${messageKey}
        AND status = 'pending'
    `;
  }

  /**
   * Marks a delivery for retry if it has attempts remaining, or fails it if it
   * does not. Does nothing if the delivery has already finished.
   *
   * @param eventId ID of the delivery's event.
   * @param handler Handler which owns the delivery.
   * @param messageKey Message key of the delivery.
   * @param delayMs Delay before the next attempt, in milliseconds.
   * @returns The delivery's resulting status, or null if the delivery is
   *     already finished or does not exist.
   */
  public async scheduleRetry(
    eventId: bigint,
    handler: string,
    messageKey: string,
    delayMs: number,
  ): Promise<DeliveryStatus | null> {
    const rows = await this.sql<{ status: DeliveryStatus }[]>`
      UPDATE effect_deliveries
      SET
        attempts_remaining = attempts_remaining - 1,
        status = CASE
          WHEN attempts_remaining <= 1 THEN 'failed'::delivery_status
          ELSE 'pending'::delivery_status
        END,
        next_attempt_at = NOW() + make_interval(secs => ${delayMs / 1000})
      WHERE event_id = ${eventId}
        AND handler = ${handler}
        AND message_key = ${messageKey}
        AND status = 'pending'
      RETURNING status
    `;

    return rows.length > 0 ? rows[0].status : null;
  }
}
