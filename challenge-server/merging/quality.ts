import { EventType } from './event';

/**
 * Emitted when a paired stream event has a temporal gap between base and
 * target larger than the configured threshold.
 */
export type LargeTemporalGapFlag = {
  kind: 'LARGE_TEMPORAL_GAP';
  eventType: EventType;
  tickGap: number;
  baseTick: number;
  targetTick: number;
};

/**
 * Emitted when an attack-mapped event has multiple candidates that disagree on
 * content and the conflict-resolution strategy is `unexpected`.
 */
export type UnexpectedConflictFlag = {
  kind: 'UNEXPECTED_CONFLICT';
  eventType: EventType;
  attackTick: number;
  candidateCount: number;
};

/**
 * Emitted when an event's cross-tick reference (e.g. `offCooldownTick`) points
 * to a client tick with no merged-space mapping. The reference is resolved
 * heuristically by offset; the result may be inaccurate.
 */
export type UnmappedCrossTickReferenceFlag = {
  kind: 'UNMAPPED_CROSS_TICK_REFERENCE';
  eventType: EventType;
  mergedTick: number;
  sourceTick: number;
  resolvedTick: number;
};

/**
 * Emitted when two clients disagree on a player attack's target on the same
 * merged tick.
 */
export type AttackTargetMismatchFlag = {
  kind: 'ATTACK_TARGET_MISMATCH';
  tick: number;
  player: string;
  keptRoomId: number;
  discardedRoomId: number;
  keptSourceClientId: number;
  discardedSourceClientId: number;
};

/**
 * Emitted when two clients disagree on a player attack's type.
 */
export type AttackTypeMismatchFlag = {
  kind: 'ATTACK_TYPE_MISMATCH';
  tick: number;
  player: string;
  keptType: number;
  discardedType: number;
  keptSourceClientId: number;
  discardedSourceClientId: number;
};

/**
 * Emitted when two clients disagree on a player spell's target on the same
 * merged tick.
 */
export type SpellTargetMismatchFlag = {
  kind: 'SPELL_TARGET_MISMATCH';
  tick: number;
  player: string;
  keptTargetKind: 'player' | 'npc';
  keptTargetId: number | string;
  discardedTargetKind: 'player' | 'npc';
  discardedTargetId: number | string;
  keptSourceClientId: number;
  discardedSourceClientId: number;
};

/**
 * Emitted when two clients disagree on a player spell's type on the same
 * merged tick.
 */
export type SpellTypeMismatchFlag = {
  kind: 'SPELL_TYPE_MISMATCH';
  tick: number;
  player: string;
  keptType: number;
  discardedType: number;
  keptSourceClientId: number;
  discardedSourceClientId: number;
};

/**
 * A diagnostic signal emitted during merge consolidation. Quality flags
 * describe data anomalies, conflicts, or alignment issues encountered while
 * merging two timelines.
 */
export type QualityFlag =
  | LargeTemporalGapFlag
  | UnexpectedConflictFlag
  | UnmappedCrossTickReferenceFlag
  | AttackTargetMismatchFlag
  | AttackTypeMismatchFlag
  | SpellTargetMismatchFlag
  | SpellTypeMismatchFlag;

export const enum MergeAlertType {
  MULTIPLE_ACCURATE_TICK_MODES = 'MULTIPLE_ACCURATE_TICK_MODES',
}

/**
 * A merge-level signal emitted during merge orchestration.
 */
export type MergeAlert = {
  type: MergeAlertType;
  details?: Record<string, unknown>;
};
