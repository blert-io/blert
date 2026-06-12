import { isMainThread } from 'node:worker_threads';

import { ClientStageStream } from '@blert/common';

import logger, { runWithLogContext } from '../log';
import { ClientEvents, Merger } from '../merging';
import { observeMergeDuration, WorkerMetricsResponder } from '../metrics';
import { MergeJob, MergeReply } from './types';

/**
 * Runs a single merge job, transforming a raw client stage stream into a merged
 * event stream with its metadata.
 *
 * @param job Merge request to run.
 * @returns The merge result, or an error if the merge failed.
 */
export function runMergeJob(job: MergeJob): MergeReply {
  return runWithLogContext(
    {
      challengeUuid: job.challengeInfo.uuid,
      stage: job.stage,
      attempt: job.attempt,
    },
    (): MergeReply => {
      try {
        const byClient = new Map<number, ClientStageStream[]>();
        for (const record of job.stream) {
          const existing = byClient.get(record.clientId);
          if (existing === undefined) {
            byClient.set(record.clientId, [record]);
          } else {
            existing.push(record);
          }
        }

        const clients: ClientEvents[] = [];
        for (const [clientId, streams] of byClient) {
          try {
            clients.push(
              ClientEvents.fromClientStream(
                clientId,
                job.challengeInfo,
                job.stage,
                streams,
              ),
            );
          } catch (e: unknown) {
            logger.error('client_event_processing_failed', {
              challengeUuid: job.challengeInfo.uuid,
              clientId,
              stage: job.stage,
              attempt: job.attempt,
              error: e instanceof Error ? e.message : String(e),
              stack: e instanceof Error ? e.stack : undefined,
            });
            // Continue processing other clients.
          }
        }

        if (clients.length === 0) {
          return { kind: 'bad_data' };
        }

        const start = process.hrtime.bigint();
        const result = new Merger(job.challengeInfo, job.stage, clients).merge(
          undefined,
          { alignMismatched: true },
        );
        observeMergeDuration(
          job.stage,
          Number(process.hrtime.bigint() - start) / 1e6,
        );
        if (result === null) {
          // `clients` is never empty, so a null results can only be due to
          // every client failing data validation.
          return { kind: 'bad_data' };
        }

        const { events, ...metadata } = result;
        return { kind: 'merged', events: events.serialize(), result: metadata };
      } catch (e: unknown) {
        logger.error('merge_job_failed', {
          error: e instanceof Error ? e.message : String(e),
          stack: e instanceof Error ? e.stack : undefined,
        });
        return { kind: 'exception' };
      }
    },
  ) as MergeReply;
}

// Held for the worker's lifetime so it keeps answering metrics scrapes.
const _metricsResponder = isMainThread ? null : new WorkerMetricsResponder();

export default runMergeJob;
