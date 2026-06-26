import { ClientAnomaly, MergeAlertType, QualityFlag } from '../merging';
import { MergeResultMetadata } from './types';

/** Why a merge's raw client streams were captured for later inspection. */
export const enum CaptureReason {
  /** Clients claiming accuracy disagreed on the stage's tick count. */
  ACCURATE_TICK_DISAGREEMENT = 'accurate_tick_disagreement',
  /** Clients reported conflicting server tick counts. */
  SERVER_TICK_DISAGREEMENT = 'server_tick_disagreement',
  /** A client's merge step was rejected by the post-merge consistency check. */
  MERGE_REJECTION = 'merge_rejection',
  /** A client stream contained multiple primary players. */
  MULTIPLE_PRIMARY_PLAYERS = 'multiple_primary_players',
  /** A merged client's confidence landed near or below the acceptance bar. */
  LOW_CONFIDENCE = 'low_confidence',
  /** A client failed basic data validation. */
  BAD_DATA = 'bad_data',
  /** A client sent events beyond its recorded tick count. */
  EVENTS_BEYOND_RECORDED_TICKS = 'events_beyond_recorded_ticks',
  /** One or more clients were not merged, without a stronger cause above. */
  UNMERGED_CLIENTS = 'unmerged_clients',
  /** A client's quality flags are noteworthy. */
  QUALITY_FLAGS = 'quality_flags',
  /** The merged timeline was offset to the end of the stage. */
  TIMELINE_OFFSET = 'timeline_offset',
  /** A game correction was applied to a client's events. */
  GAME_CORRECTION = 'game_correction',
  /**
   * The merge failed outright; the captured streams are its reproduction case.
   */
  MERGE_FAILED = 'merge_failed',
  /** Background sample of a clean merge, keeping the corpus representative. */
  BASELINE = 'baseline',
  /** Merges captured in a development environment. */
  DEVELOPMENT = 'development',
}

/**
 * Per-reason sampling rates. A triggered reason saves the stage's raw streams
 * with probability equal to its rate.
 */
const CAPTURE_RATES: Record<CaptureReason, number> = {
  [CaptureReason.ACCURATE_TICK_DISAGREEMENT]: 1,
  [CaptureReason.SERVER_TICK_DISAGREEMENT]: 1,
  [CaptureReason.MERGE_REJECTION]: 1,
  [CaptureReason.MULTIPLE_PRIMARY_PLAYERS]: 1,
  // High while the merge confidence threshold is calibrated against real data.
  [CaptureReason.LOW_CONFIDENCE]: 0.5,
  [CaptureReason.BAD_DATA]: 0.25,
  [CaptureReason.EVENTS_BEYOND_RECORDED_TICKS]: 0.25,
  [CaptureReason.UNMERGED_CLIENTS]: 0.25,
  [CaptureReason.QUALITY_FLAGS]: 0.25,
  [CaptureReason.TIMELINE_OFFSET]: 0.05,
  [CaptureReason.GAME_CORRECTION]: 0.1,
  [CaptureReason.MERGE_FAILED]: 1,
  [CaptureReason.BASELINE]: 0.005,
  [CaptureReason.DEVELOPMENT]: 1,
};

/**
 * Captures clients whose merge confidence landed near the acceptance
 * threshold, on either side: borderline passes are as informative for
 * threshold calibration as failures.
 */
const LOW_CONFIDENCE_CAPTURE_BOUND = 0.85;

/** Quality flag kinds that are noteworthy enough to warrant capture. */
const NOTEWORTHY_QUALITY_FLAGS = new Set<QualityFlag['kind']>([
  'ATTACK_TYPE_MISMATCH',
  'ATTACK_TARGET_MISMATCH',
  'SPELL_TYPE_MISMATCH',
  'SPELL_TARGET_MISMATCH',
  'NPC_ATTACK_TYPE_MISMATCH',
  'NPC_ATTACK_TARGET_MISMATCH',
  'UNEXPECTED_CONFLICT',
]);

/**
 * Determines every reason a merge's raw streams are eligible for capture.
 * A clean merge is eligible only as a background baseline sample.
 *
 * @param result Metadata of the completed merge.
 * @returns The applicable capture reasons.
 */
export function captureReasons(result: MergeResultMetadata): CaptureReason[] {
  const reasons = new Set<CaptureReason>();

  for (const alert of result.alerts) {
    switch (alert.type) {
      case MergeAlertType.MULTIPLE_ACCURATE_TICK_MODES:
        reasons.add(CaptureReason.ACCURATE_TICK_DISAGREEMENT);
        break;
      case MergeAlertType.MULTIPLE_SERVER_TICK_COUNTS:
        reasons.add(CaptureReason.SERVER_TICK_DISAGREEMENT);
        break;
      case MergeAlertType.POST_MERGE_CONSISTENCY_REJECTIONS:
      case MergeAlertType.LOW_CONFIDENCE_REJECTIONS:
        reasons.add(CaptureReason.MERGE_REJECTION);
        break;
      case MergeAlertType.TIMELINE_OFFSET_APPLIED:
        // Single client offsets are just late joiners; not interesting.
        if (result.clients.length > 1) {
          reasons.add(CaptureReason.TIMELINE_OFFSET);
        }
        break;
      case MergeAlertType.LOW_STRUCTURAL_CONFIDENCE:
        reasons.add(CaptureReason.LOW_CONFIDENCE);
        break;
      default: {
        const _exhaustive: never = alert.type;
        break;
      }
    }
  }

  for (const client of result.clients) {
    for (const anomaly of client.anomalies) {
      switch (anomaly) {
        case ClientAnomaly.MULTIPLE_PRIMARY_PLAYERS:
          reasons.add(CaptureReason.MULTIPLE_PRIMARY_PLAYERS);
          break;
        case ClientAnomaly.BAD_DATA:
          reasons.add(CaptureReason.BAD_DATA);
          break;
        case ClientAnomaly.EVENTS_BEYOND_RECORDED_TICKS:
          reasons.add(CaptureReason.EVENTS_BEYOND_RECORDED_TICKS);
          break;
        case ClientAnomaly.GAME_CORRECTION_APPLIED:
          reasons.add(CaptureReason.GAME_CORRECTION);
          break;
        // Consistency issues are almost exclusively client lag, and missing
        // stage metadata is routine disconnect noise; neither warrants a
        // capture by itself.
        case ClientAnomaly.CONSISTENCY_ISSUES:
        case ClientAnomaly.MISSING_STAGE_METADATA:
          break;
        default: {
          const _exhaustive: never = anomaly;
          break;
        }
      }
    }

    if (
      client.worstSegmentScore !== null &&
      client.worstSegmentScore < LOW_CONFIDENCE_CAPTURE_BOUND
    ) {
      reasons.add(CaptureReason.LOW_CONFIDENCE);
    }

    if (
      client.qualityFlags.some((flag) =>
        NOTEWORTHY_QUALITY_FLAGS.has(flag.kind),
      )
    ) {
      reasons.add(CaptureReason.QUALITY_FLAGS);
    }
  }

  if (result.unmergedCount > 0 || result.skippedCount > 0) {
    reasons.add(CaptureReason.UNMERGED_CLIENTS);
  }

  if (process.env.NODE_ENV === 'development' && result.clients.length > 1) {
    reasons.add(CaptureReason.DEVELOPMENT);
  }

  if (reasons.size === 0) {
    reasons.add(CaptureReason.BASELINE);
  }

  return [...reasons];
}

/**
 * Rolls each capture reason against its sampling rate.
 *
 * @param reasons Applicable reasons from `captureReasons`.
 * @param rng Random source returning values in [0, 1).
 * @returns `true` if any reason passed its roll, `false` otherwise.
 */
export function sampleCapture(
  reasons: readonly CaptureReason[],
  rng: () => number = Math.random,
): boolean {
  return reasons.some((reason) => rng() < CAPTURE_RATES[reason]);
}
