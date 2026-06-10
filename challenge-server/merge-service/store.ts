import { Stage } from '@blert/common';
import type postgres from 'postgres';

import { ChallengeInfo, MergedEvents, QualityFlag } from '../merging';
import { CaptureReason } from './policy';
import { MergeResultMetadata } from './types';

/** Outcome of a processed stage merge. */
export type StageMerge = {
  challengeInfo: ChallengeInfo;
  stage: Stage;
  attempt: number | null;
  result: MergeResultMetadata;
  events: MergedEvents;
  /** Set if this merge's raw streams were captured. */
  capture: { reasons: CaptureReason[]; file: string } | null;
};

/** Persists processed stage merge results. */
export interface MergeResultStore {
  saveStageMerge(merge: StageMerge): Promise<void>;
}

function countQualityFlags(flags: QualityFlag[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const flag of flags) {
    counts[flag.kind] = (counts[flag.kind] ?? 0) + 1;
  }
  return counts;
}

export class PostgresMergeResultStore implements MergeResultStore {
  public constructor(private readonly sql: postgres.Sql) {}

  public async saveStageMerge(merge: StageMerge): Promise<void> {
    const { challengeInfo, stage, attempt, result, events, capture } = merge;

    await this.sql.begin(async (tx) => {
      const [challenge] = await tx<{ id: number }[]>`
        SELECT id FROM challenges WHERE uuid = ${challengeInfo.uuid}
      `;
      if (challenge === undefined) {
        throw new Error(`No challenge with UUID ${challengeInfo.uuid}`);
      }

      const [row] = await tx<{ id: number }[]>`
        INSERT INTO challenge_stage_merges (
          challenge_id,
          stage,
          attempt,
          status,
          last_tick,
          missing_tick_count,
          precise_server_tick_count,
          accurate_until,
          queryable_until,
          reference_method,
          reference_tick_count,
          merged_count,
          unmerged_count,
          skipped_count,
          alert_types,
          capture_reasons,
          capture_file
        ) VALUES (
          ${challenge.id},
          ${stage},
          ${attempt},
          ${events.getStatus()},
          ${events.getLastTick()},
          ${events.getMissingTickCount()},
          ${events.hasPreciseServerTickCount()},
          ${events.accurateUntil()},
          ${events.queryableUntil()},
          ${result.referenceSelection.method},
          ${result.referenceSelection.count},
          ${result.mergedCount},
          ${result.unmergedCount},
          ${result.skippedCount},
          ${result.alerts.map((alert) => alert.type)},
          ${capture?.reasons ?? null},
          ${capture?.file ?? null}
        )
        RETURNING id
      `;

      const clientRows = result.clients.map((client) => ({
        merge_id: row.id,
        client_id: client.id,
        user_id: client.metadata?.userId ?? null,
        plugin_version: client.metadata?.pluginVersion ?? null,
        runelite_version: client.metadata?.runeLiteVersion ?? null,
        status: client.status,
        classification: client.classification,
        recorded_ticks: client.recordedTicks,
        server_tick_count: client.serverTicks?.count ?? null,
        server_ticks_precise: client.serverTicks?.precise ?? null,
        reported_accurate: client.reportedAccurate,
        derived_accurate: client.derivedAccurate,
        anomalies: client.anomalies,
        worst_segment_score: client.worstSegmentScore,
        quality_flag_counts: tx.json(countQualityFlags(client.qualityFlags)),
      }));
      await tx`INSERT INTO challenge_merge_clients ${tx(clientRows)}`;
    });
  }
}
