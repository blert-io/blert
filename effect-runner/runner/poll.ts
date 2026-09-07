import logger from '../log';
import {
  observePoll,
  recordPollError,
  setOldestOutstandingEventAge,
} from '../metrics';
import { IntervalTask } from '../task';
import { Dispatcher } from './dispatch';
import { EffectStore, Subscription } from './store';

/** Repeatedly polls the effect store and dispatches events to subscriptions. */
export class Poller {
  private readonly store: EffectStore;
  private readonly dispatcher: Dispatcher;
  private readonly subscriptions: Subscription[];
  private readonly task: IntervalTask;

  /**
   * @param store Store to poll.
   * @param dispatcher Dispatcher for the polled events.
   * @param subscriptions Subscriptions whose work the poller queries.
   * @param intervalMs Delay between the end of one tick and the next.
   */
  public constructor(
    store: EffectStore,
    dispatcher: Dispatcher,
    subscriptions: Subscription[],
    intervalMs: number,
  ) {
    this.store = store;
    this.dispatcher = dispatcher;
    this.subscriptions = subscriptions;
    this.task = new IntervalTask(() => this.tick(), {
      intervalMs,
      onError: (e) => {
        logger.error('poll_error', {
          error: e instanceof Error ? e.message : String(e),
        });
        recordPollError();
      },
    });
  }

  /** Starts polling. The first tick runs after one interval. */
  public start(): void {
    this.task.start();
  }

  /** Stops polling, waiting for an in-flight tick to complete. */
  public async stop(): Promise<void> {
    await this.task.stop();
  }

  private async tick(): Promise<void> {
    const start = Date.now();

    const events = await this.store.pollReadyEvents(this.subscriptions);
    await this.dispatcher.dispatchBatch(events);

    const oldest = await this.store.oldestOutstanding(this.subscriptions);
    setOldestOutstandingEventAge(
      oldest === null ? 0 : Date.now() - oldest.getTime(),
    );
    observePoll(Date.now() - start);
  }
}
