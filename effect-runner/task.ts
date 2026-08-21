export interface IntervalTaskOptions {
  /** Delay between the end of one run and the start of the next. */
  intervalMs: number;
  /** Invoked on runs that throw. If omitted, errors are swallowed silently. */
  onError?: (error: unknown) => void;
}

type IntervalTaskState =
  | { tag: 'idle' }
  | { tag: 'scheduled'; timer: NodeJS.Timeout }
  | { tag: 'running'; promise: Promise<void> };

/** Runs a function repeatedly with a configured gap between runs. */
export class IntervalTask {
  private readonly tick: () => Promise<void>;
  private readonly intervalMs: number;
  private readonly onError?: (error: unknown) => void;

  private active: boolean;
  private state: IntervalTaskState;

  public constructor(tick: () => Promise<void>, options: IntervalTaskOptions) {
    this.tick = tick;
    this.intervalMs = options.intervalMs;
    this.onError = options.onError;
    this.active = false;
    this.state = { tag: 'idle' };
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

    if (this.state.tag === 'scheduled') {
      clearTimeout(this.state.timer);
      this.state = { tag: 'idle' };
    } else if (this.state.tag === 'running') {
      await this.state.promise;
    }
  }

  private scheduleNext(): void {
    this.state = {
      tag: 'scheduled',
      timer: setTimeout(() => {
        const promise = this.runOnce();
        this.state = { tag: 'running', promise };
        void promise.finally(() => {
          this.state = { tag: 'idle' };
          if (this.active) {
            this.scheduleNext();
          }
        });
      }, this.intervalMs),
    };
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
