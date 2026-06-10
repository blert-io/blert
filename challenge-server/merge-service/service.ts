import {
  ClientStageStream,
  DataRepository,
  Stage,
  StageStreamType,
} from '@blert/common';

import logger from '../log';
import { ChallengeInfo, MergeClientStatus, MergedEvents } from '../merging';
import {
  recordClientAnomaly,
  recordClientReportedTimePrecision,
  recordMergeAlert,
  recordMergeClient,
  recordMergeResultWrite,
  recordRepositoryWrite,
  recordStageCompletion,
  recordStageEventPayload,
  recordStreamCapture,
  recordStreamCaptureSuppressed,
} from '../metrics';
import { CaptureReason, captureReasons, sampleCapture } from './policy';
import { MergeResultStore, StageMerge } from './store';
import {
  MergeReply,
  MergeResultMetadata,
  MergeRunner,
  UnmergedEventData,
} from './types';

export type MergeServiceConfig = {
  /** Optional repository for sampling raw streams for later inspection. */
  samplingRepository?: DataRepository;
  /**
   * Maximum stream captures saved per hour. Can be set to prevent client
   * regressions from inflating a capture signal and filling up the repository.
   */
  maxCapturesPerHour?: number;
  /** Optional data store recording the outcome of every processed merge. */
  resultStore?: MergeResultStore;
};

const DEFAULT_MAX_CAPTURES_PER_HOUR = 25;
const CAPTURE_WINDOW_MS = 60 * 60 * 1000;

/** A capture index record describing one saved raw stream file. */
export type CaptureIndexEntry = {
  file: string;
  challengeId: string;
  stage: Stage;
  attempt: number | null;
  reasons: CaptureReason[];
  savedAt: number;
};

/** Conditions a capture must match to be listed. All set fields must match. */
export type CaptureFilters = {
  reason?: CaptureReason;
  challengeId?: string;
  stage?: Stage;
  attempt?: number | null;
};

/**
 * The boundary between the challenge pipeline and the merge subsystem.
 * Executes merge jobs on the configured runner.
 */
export class MergeService {
  // Serializes capture index updates; each append performs a read-modify-write
  // of the index file, and concurrent stage captures would otherwise race it.
  private captureIndexLock: Promise<void> = Promise.resolve();

  private captureWindowStart: number = 0;
  private captureWindowCount: number = 0;

  public constructor(
    private readonly runner: MergeRunner,
    private readonly config: MergeServiceConfig = {},
  ) {}

  /**
   * Merges a stage's raw client streams into a canonical event stream.
   *
   * @param challengeInfo The challenge metadata.
   * @param stage Stage to which the stream belongs.
   * @param attempt Stage attempt number.
   * @param stream The raw client streams.
   * @returns The merged events, or `null` either if there is nothing to merge
   *   or the merge failed.
   */
  public async merge(
    challengeInfo: ChallengeInfo,
    stage: Stage,
    attempt: number | null,
    stream: ClientStageStream[],
  ): Promise<MergedEvents | null> {
    let totalBytes = 0;
    const clientIds = new Set<number>();
    for (const record of stream) {
      clientIds.add(record.clientId);
      if (record.type === StageStreamType.STAGE_EVENTS) {
        totalBytes += record.events.length;
      }
    }
    if (clientIds.size === 0) {
      return null;
    }
    recordStageEventPayload(stage, totalBytes, clientIds.size);

    let reply: MergeReply;
    try {
      reply = await this.runner.run({ challengeInfo, stage, attempt, stream });
    } catch (e: unknown) {
      logger.error('merge_runner_run_failed', {
        stage,
        error: e instanceof Error ? e.message : String(e),
      });
      return null;
    }

    if (reply.kind !== 'merged') {
      // Errors are logged within the runner.
      return null;
    }

    const { result } = reply;

    for (const client of result.clients) {
      recordMergeClient(client.classification, client.status);
      for (const anomaly of client.anomalies) {
        recordClientAnomaly(stage, anomaly);
      }
      if (client.serverTicks !== null) {
        recordClientReportedTimePrecision(
          client.serverTicks.precise ? 'precise' : 'imprecise',
        );
      }
    }
    for (const alert of result.alerts) {
      recordMergeAlert(stage, alert.type);
    }

    let capture: StageMerge['capture'] = null;
    if (this.config.samplingRepository !== undefined) {
      const reasons = captureReasons(result);
      if (sampleCapture(reasons)) {
        if (this.tryReserveCapture()) {
          reasons.forEach(recordStreamCapture);
          capture = {
            reasons,
            file: unmergedEventsFile(challengeInfo.uuid, stage, attempt),
          };
          setTimeout(
            () =>
              void this.saveRawStreams(
                challengeInfo,
                stage,
                attempt,
                stream,
                result,
                reasons,
              ),
            0,
          );
        } else {
          recordStreamCaptureSuppressed();
          logger.warn('stream_capture_rate_limited', { stage, reasons });
        }
      }
    }

    let events: MergedEvents;
    try {
      events = MergedEvents.deserialize(reply.events);
    } catch (e: unknown) {
      logger.error('merge_events_deserialization_failed', {
        stage,
        error: e instanceof Error ? e.message : String(e),
      });
      return null;
    }
    recordStageCompletion(
      stage,
      events.getStatus(),
      events.isAccurate(),
      result.unmergedCount > 0,
      result.skippedCount > 0,
    );

    if (this.config.resultStore !== undefined) {
      await this.persistMergeResult({
        challengeInfo,
        stage,
        attempt,
        result,
        events,
        capture,
      });
    }

    return events;
  }

  /** Terminates the merge runner. */
  public async shutdown(): Promise<void> {
    await this.runner.destroy();
  }

  /**
   * Lists raw stream captures, most recent first.
   *
   * @param filters Conditions a capture must match to be returned.
   * @param limit Maximum number of entries to return.
   * @returns The matching capture index entries.
   */
  public async listCaptures(
    filters: CaptureFilters = {},
    limit: number = 50,
  ): Promise<CaptureIndexEntry[]> {
    if (this.config.samplingRepository === undefined) {
      return [];
    }

    let entries: CaptureIndexEntry[];
    try {
      const data =
        await this.config.samplingRepository.loadRaw(CAPTURE_INDEX_FILE);
      entries = JSON.parse(data.toString()) as CaptureIndexEntry[];
    } catch {
      return [];
    }

    return entries
      .filter((entry) => entryMatches(filters, entry))
      .sort((a, b) => b.savedAt - a.savedAt)
      .slice(0, limit);
  }

  private async persistMergeResult(merge: StageMerge): Promise<void> {
    try {
      await this.config.resultStore!.saveStageMerge(merge);
      recordMergeResultWrite('success');
    } catch (e: unknown) {
      recordMergeResultWrite('error');
      logger.error('merge_result_persist_failed', {
        challengeUuid: merge.challengeInfo.uuid,
        stage: merge.stage,
        attempt: merge.attempt,
        error: e instanceof Error ? e.message : String(e),
        stack: e instanceof Error ? e.stack : undefined,
      });
    }
  }

  private async saveRawStreams(
    challengeInfo: ChallengeInfo,
    stage: Stage,
    attempt: number | null,
    stream: ClientStageStream[],
    result: MergeResultMetadata,
    reasons: CaptureReason[],
  ): Promise<void> {
    // Save all event data as a single JSON file. This is inefficient as the
    // files are quite large, but it's simple to work with and debug. Ideally,
    // the amount of merge failures should reduce over time, making this less
    // of a concern :)
    const stageEventData: UnmergedEventData = {
      challengeInfo,
      stage,
      attempt,
      captureReasons: reasons,
      mergedClients: result.clients.filter(
        (client) => client.status === MergeClientStatus.MERGED,
      ),
      unmergedClients: result.clients.filter(
        (client) => client.status === MergeClientStatus.UNMERGED,
      ),
      rawEvents: stream,
    };

    const repository = this.config.samplingRepository!;
    const file = unmergedEventsFile(challengeInfo.uuid, stage, attempt);

    try {
      await repository.saveRaw(
        file,
        Buffer.from(JSON.stringify(stageEventData)),
      );
      recordRepositoryWrite('test', 'unmerged_events', 'success');
      logger.info('unmerged_events_saved', {
        challengeUuid: challengeInfo.uuid,
        stage,
        attempt,
        reasons,
        mergedCount: result.mergedCount,
        unmergedCount: result.unmergedCount,
        skippedCount: result.skippedCount,
      });
    } catch (e) {
      recordRepositoryWrite('test', 'unmerged_events', 'error');
      logger.error('unmerged_events_save_error', {
        challengeUuid: challengeInfo.uuid,
        stage,
        error: e instanceof Error ? e.message : String(e),
        stack: e instanceof Error ? e.stack : undefined,
      });
      return;
    }

    try {
      await this.appendToCaptureIndex({
        file,
        challengeId: challengeInfo.uuid,
        stage,
        attempt,
        reasons,
        savedAt: Date.now(),
      });
    } catch (e) {
      logger.error('capture_index_update_error', {
        challengeUuid: challengeInfo.uuid,
        stage,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  /** Reserves a capture slot in the current rate window, if one is free. */
  private tryReserveCapture(): boolean {
    const now = Date.now();
    if (now - this.captureWindowStart >= CAPTURE_WINDOW_MS) {
      this.captureWindowStart = now;
      this.captureWindowCount = 0;
    }

    const cap = this.config.maxCapturesPerHour ?? DEFAULT_MAX_CAPTURES_PER_HOUR;
    if (this.captureWindowCount >= cap) {
      return false;
    }
    this.captureWindowCount++;
    return true;
  }

  private appendToCaptureIndex(entry: CaptureIndexEntry): Promise<void> {
    const task = this.captureIndexLock.then(() =>
      this.writeCaptureIndexEntry(entry),
    );
    // Keep the lock chain alive on failure; the caller handles the error.
    this.captureIndexLock = task.catch(() => {
      /* no-op */
    });
    return task;
  }

  private async writeCaptureIndexEntry(
    entry: CaptureIndexEntry,
  ): Promise<void> {
    const repository = this.config.samplingRepository!;
    let entries: CaptureIndexEntry[] = [];
    try {
      const data = await repository.loadRaw(CAPTURE_INDEX_FILE);
      entries = JSON.parse(data.toString()) as CaptureIndexEntry[];
    } catch {
      // Missing or corrupt index; start fresh.
    }
    entries.push(entry);
    await repository.saveRaw(
      CAPTURE_INDEX_FILE,
      Buffer.from(JSON.stringify(entries)),
    );
  }
}

function entryMatches(
  filters: CaptureFilters,
  entry: CaptureIndexEntry,
): boolean {
  const equals = (field: keyof CaptureFilters) => {
    const v = filters[field];
    const e = entry[field as keyof CaptureIndexEntry];
    return v === undefined || v === e;
  };

  if (filters.reason !== undefined && !entry.reasons.includes(filters.reason)) {
    return false;
  }

  return equals('challengeId') && equals('stage') && equals('attempt');
}

const UNMERGED_EVENTS_DIR = 'unmerged-events';
const CAPTURE_INDEX_FILE = `${UNMERGED_EVENTS_DIR}/index.json`;

export function unmergedEventsFile(
  challengeId: string,
  stage: Stage,
  attempt?: number | null,
): string {
  const attemptSuffix =
    attempt !== undefined && attempt !== null ? `:${attempt}` : '';
  return `${UNMERGED_EVENTS_DIR}/${challengeId}:${stage}${attemptSuffix}_events.json`;
}

export type UnmergedEventsFileInfo = {
  challengeId: string;
  stage: Stage;
  attempt: number | null;
};

const UNMERGED_EVENTS_FILE_PATTERN =
  /^([0-9a-f-]+):(\d+)(?::(\d+))?_events\.json$/;

/**
 * Parses a capture file path produced by `unmergedEventsFile`.
 *
 * @param path Path or basename of the capture file.
 * @returns The parsed fields, or `null` if the file name is not a capture.
 */
export function parseUnmergedEventsFile(
  path: string,
): UnmergedEventsFileInfo | null {
  const basename = path.split('/').pop() ?? '';
  const match = UNMERGED_EVENTS_FILE_PATTERN.exec(basename);
  if (match === null) {
    return null;
  }
  return {
    challengeId: match[1],
    stage: Number(match[2]) as Stage,
    attempt: match[3] !== undefined ? Number(match[3]) : null,
  };
}
