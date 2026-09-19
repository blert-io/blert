import logger from '../log';
import { observeSweep } from '../metrics';
import { IntervalTask } from '../task';
import { EffectStore, Subscription } from './store';

const SWEEP_INTERVAL_MS = 60 * 60 * 1000;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** Periodically deletes fully delivered events from the store. */
export class Sweeper {
  private readonly store: EffectStore;
  private readonly subscriptions: Subscription[];
  private readonly retentionMs: number;
  private readonly task: IntervalTask;

  /**
   * @param store Store to sweep.
   * @param subscriptions Subscriptions whose outstanding work protects an
   *   event from deletion.
   * @param intervalMs Delay between sweeps.
   * @param retentionMs Age at which a finished event is deleted.
   */
  public constructor(
    store: EffectStore,
    subscriptions: Subscription[],
    intervalMs: number = SWEEP_INTERVAL_MS,
    retentionMs: number = RETENTION_MS,
  ) {
    this.store = store;
    this.subscriptions = subscriptions;
    this.retentionMs = retentionMs;
    this.task = new IntervalTask(() => this.sweep(), { intervalMs });
  }

  /** Begins the sweeper on an interval with the first occurring immediately. */
  public async start(): Promise<void> {
    await this.sweep();
    this.task.start();
  }

  /** Stops sweeping, finishing any active run.. */
  public async stop(): Promise<void> {
    await this.task.stop();
  }

  private async sweep(): Promise<void> {
    const cutoff = new Date(Date.now() - this.retentionMs);

    try {
      const deleted = await this.store.sweepEvents(this.subscriptions, cutoff);
      observeSweep(deleted);
      logger.info('effect_sweep', { deleted, cutoff: cutoff.toISOString() });
    } catch (e) {
      logger.error('effect_sweep_error', {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
}
