import { availableParallelism } from 'node:os';
import path from 'node:path';

import { Piscina } from 'piscina';

import logger from '../log';
import { MergeJob, MergeReply, MergeRunner } from './types';

export type MergePoolOptions = {
  /**
   * Number of worker threads.
   * Defaults to one less than the number of available cores.
   */
  size?: number;
  /** Per-worker old-generation heap cap, in MB. */
  maxOldGenerationSizeMb?: number;
  /** Jobs allowed to queue beyond the busy workers before `run` rejects. */
  maxQueue?: number | 'auto';
};

/**
 * A fixed pool of worker threads that run merge jobs off the main thread.
 */
export class MergePool implements MergeRunner {
  private readonly piscina: Piscina<MergeJob, MergeReply>;

  public constructor(options: MergePoolOptions = {}) {
    const size = options.size ?? Math.max(1, availableParallelism() - 1);
    const maxQueue = options.maxQueue ?? Infinity;

    logger.info('merge_pool_starting', {
      threads: size,
      queue: maxQueue,
    });

    this.piscina = new Piscina<MergeJob, MergeReply>({
      filename: path.join(__dirname, 'worker.js'),
      minThreads: size,
      maxThreads: size,
      maxQueue: maxQueue,
      // Piscina's default ('sync') parks idle workers in Atomics.wait,
      // freezing their event loops; they must stay responsive to answer
      // metrics scrapes over the BroadcastChannel.
      atomics: 'disabled',
      resourceLimits:
        options.maxOldGenerationSizeMb !== undefined
          ? { maxOldGenerationSizeMb: options.maxOldGenerationSizeMb }
          : undefined,
    });
  }

  /**
   * Runs a merge job on a worker.
   *
   * @param job Merge request to run.
   * @returns The merge result indicating success or failure.
   * @throws If the worker thread dies or the queue is full.
   */
  public run(job: MergeJob): Promise<MergeReply> {
    return this.piscina.run(job);
  }

  /** Drains in-flight jobs and terminates all workers. */
  public async destroy(): Promise<void> {
    await this.piscina.destroy();
  }
}
