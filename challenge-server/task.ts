export interface IntervalTaskOptions {
  /** Delay between the end of one run and the start of the next, in ms. */
  intervalMs: number;
  /** Invoked if a run throws. If omitted, errors are swallowed silently. */
  onError?: (error: unknown) => void;
}

/**
 * Runs an asynchronous task repeatedly, waiting a fixed interval between the
 * completion of one run and the start of the next.
 */
export class IntervalTask {
  private readonly tick: () => Promise<void>;
  private readonly intervalMs: number;
  private readonly onError?: (error: unknown) => void;

  private active: boolean;
  private timer: NodeJS.Timeout | null;
  private running: Promise<void> | null;

  public constructor(tick: () => Promise<void>, options: IntervalTaskOptions) {
    this.tick = tick;
    this.intervalMs = options.intervalMs;
    this.onError = options.onError;
    this.active = false;
    this.timer = null;
    this.running = null;
  }

  /**
   * Starts the loop, scheduling the first run after the configured interval.
   * Does nothing if the task is already active.
   */
  public start(): void {
    if (this.active) {
      return;
    }
    this.active = true;
    this.scheduleNext();
  }

  /** Stops the loop, waiting for any in-flight run to complete. */
  public async stop(): Promise<void> {
    this.active = false;

    // Exactly one of `timer` and `running` is non-null while the loop is
    // active, and the transition between them is synchronous, so observing
    // them here cannot race with a run starting.
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.running !== null) {
      await this.running;
    }
  }

  private scheduleNext(): void {
    this.timer = setTimeout(() => {
      this.timer = null;
      const run = this.runOnce();
      this.running = run;
      void run.finally(() => {
        this.running = null;
        if (this.active) {
          this.scheduleNext();
        }
      });
    }, this.intervalMs);
  }

  private async runOnce(): Promise<void> {
    try {
      await this.tick();
    } catch (e: unknown) {
      if (this.onError !== undefined) {
        this.onError(e);
      }
    }
  }
}

/** Tracks in-flight async tasks so they can be awaited as a group. */
export class PendingTasks {
  private readonly tasks = new Set<Promise<void>>();

  /**
   * Registers a task, removing it automatically once it settles.
   * @param task The task to track.
   */
  public add(task: Promise<void>): void {
    this.tasks.add(task);
    const remove = (): void => {
      this.tasks.delete(task);
    };
    task.then(remove, remove);
  }

  /** Resolves once every tracked task has settled. */
  public async drain(): Promise<void> {
    await Promise.allSettled(this.tasks);
  }

  /** The number of tracked tasks. */
  public get size(): number {
    return this.tasks.size;
  }
}
