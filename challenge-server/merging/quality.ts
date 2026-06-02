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
 * Emitted when an event's cross-tick reference (e.g. `npcAttackTick`) points
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
 * Emitted when two clients disagree on an NPC attack's type for the same NPC
 * on a shared merged tick.
 */
export type NpcAttackTypeMismatchFlag = {
  kind: 'NPC_ATTACK_TYPE_MISMATCH';
  tick: number;
  roomId: number;
  npcId: number;
  keptType: number;
  discardedType: number;
  keptSourceClientId: number;
  discardedSourceClientId: number;
};

/**
 * Emitted when two clients disagree on an NPC attack's target on the same
 * merged tick.
 */
export type NpcAttackTargetMismatchFlag = {
  kind: 'NPC_ATTACK_TARGET_MISMATCH';
  tick: number;
  roomId: number;
  npcId: number;
  keptTarget: string | null;
  discardedTarget: string | null;
  keptSourceClientId: number;
  discardedSourceClientId: number;
};

/**
 * Emitted when an attack-mapped event references an NPC attack that did not
 * survive consolidation in the merged tick state. The event is discarded.
 */
export type AttackMappedNotFoundFlag = {
  kind: 'ATTACK_MAPPED_NOT_FOUND';
  eventType: EventType;
  source: 'base' | 'target';
  clientTick: number;
  referencedTick: number;
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
  | SpellTypeMismatchFlag
  | NpcAttackTypeMismatchFlag
  | NpcAttackTargetMismatchFlag
  | AttackMappedNotFoundFlag;

export const enum MergeAlertType {
  MULTIPLE_ACCURATE_TICK_MODES = 'MULTIPLE_ACCURATE_TICK_MODES',
  /**
   * The server-reported tick counts disagree across clients (precise or
   * imprecise). Non-consensus likely indicates a bad client.
   */
  MULTIPLE_SERVER_TICK_COUNTS = 'MULTIPLE_SERVER_TICK_COUNTS',
  POST_MERGE_CONSISTENCY_REJECTIONS = 'POST_MERGE_CONSISTENCY_REJECTIONS',
  /**
   * A client was merged but a segment of its alignment scored below the
   * structural confidence warning threshold.
   */
  LOW_STRUCTURAL_CONFIDENCE = 'LOW_STRUCTURAL_CONFIDENCE',
}

/**
 * A merge-level signal emitted during merge orchestration.
 */
export type MergeAlert = {
  type: MergeAlertType;
  details?: Record<string, unknown>;
};
