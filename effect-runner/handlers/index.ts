import { EffectHandler, Subscription } from '../runner';

export { FeedHandler } from './feed';
export { logHandler } from './log';

/**
 * Lists the subscription of each handler to each of its event kinds.
 * @param handlers The handlers whose subscriptions to list.
 * @returns A subscription for each handler and kind.
 */
export function subscriptionsOf(
  handlers: readonly EffectHandler[],
): Subscription[] {
  return handlers.flatMap((handler) =>
    handler.kinds.map((kind) => ({ handler: handler.key, kind })),
  );
}
