import { EffectEventKind, EffectSubject } from '../effects';

/** An effect event of kind `K`. */
export type EffectEvent<K extends EffectEventKind = EffectEventKind> = {
  [P in K]: {
    id: bigint;
    kind: P;
    subject: EffectSubject[P];
    createdAt: Date;
  };
}[K];

/** The result of a delivery attempt. */
export type DeliveryOutcome =
  | { status: 'delivered' }
  | { status: 'skipped'; reason?: string }
  | { status: 'retry'; after?: number; reason: string }
  | { status: 'failed'; reason: string };

/** Message key for a handler which only scheduled a single message. */
export const SINGLE_MESSAGE_KEY = '*';

/** Message key for a handler which did not schedule anything. */
export const EMPTY_KEY = '';

/** A handler delivers messages triggered by effect events. */
export interface EffectHandler {
  /** Unique name for the handler. Stable across deploys. */
  readonly key: string;

  /** Events to which this handler subscribes. */
  readonly kinds: readonly EffectEventKind[];

  /**
   * How long after an event is posted that it should be routed to the handler.
   * If absent, routes every event.
   */
  readonly maxAge?: number;

  /**
   * Delivery attempts per message before it is marked failed.
   * If absent, a small default is used.
   */
  readonly attempts?: number;

  /**
   * Default backoff time between attempts, in milliseconds, unless overridden
   * by `retry` outcomes.
   * If absent, a conservative default is used.
   */
  readonly backoffMs?: number;

  /**
   * Decides how to process an event, returning a set of message keys for its
   * delivery actions. Keys must be stable across calls.
   */
  plan(event: EffectEvent): Promise<string[]>;

  /** Runs a single delivery attempt for the given message. */
  deliver(event: EffectEvent, messageKey: string): Promise<DeliveryOutcome>;
}
