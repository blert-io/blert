import { DataSource } from '@blert/common';
import { Event } from '@blert/common/generated/event_pb';

import { AlignmentResult, LocalAlignment } from './alignment';
import { ReferenceSelection } from './classification';
import { EventType } from './event';
import {
  AttackMappedCandidate,
  ResolutionStrategy,
} from './event-consolidator';
import { MergeClientClassification, MergeClientStatus } from './merge';
import { QualityFlag } from './quality';
import { MergeMapping, TickMapping } from './tick-mapping';
import { NpcState, PlayerState, TickState, TickStateArray } from './tick-state';

export type PlayerSummary = {
  username: string;
  source: DataSource;
  x: number;
  y: number;
  isDead: boolean;
  attack: { type: number; weaponId: number; target: number | null } | null;
};

export type NpcSummary = {
  roomId: number;
  id: number;
  x: number;
  y: number;
  hitpoints: { current: number; base: number };
  attack: { type: number; target: string | null } | null;
};

export type TickSummary = {
  tick: number;
  players: PlayerSummary[];
  npcs: NpcSummary[];
  eventCounts: Record<string, number>;
};

export type SerializedAlignmentResult = {
  alignments: LocalAlignment[];
  coverage: number;
  gapCount: number;
};

export type InputClientInfo = {
  clientId: number;
  recordedTicks: number;
  accurate: boolean;
  reportedAccurate: boolean;
  spectator: boolean;
  ticks: TickSummary[];
};

export type ClassificationInfo = {
  referenceSelection: ReferenceSelection;
  baseClientId: number;
  matchingClientIds: number[];
  mismatchedClientIds: number[];
  accuracyDemotions: number[];
};

/** Result of temporal matching for a single stream event occurrence. */
export type StreamReconciliationEntry = {
  eventType: string;
  /** Dedup identity key (e.g. player name, NPC room ID). */
  identityKey: string;
  /** Base side occurrence, null if only target had this event. */
  base: {
    mergedTick: number;
    clientTick: number;
  } | null;
  /** Target side occurrence, null if only base had this event. */
  target: {
    mergedTick: number;
    clientTick: number;
  } | null;
  /** Tick in the merged timeline where the event was placed, null if discarded. */
  resolvedTick: number | null;
  /** Absolute tick gap between base and target when paired. */
  tickGap: number | null;
  outcome: 'PAIRED' | 'UNPAIRED_BASE' | 'UNPAIRED_TARGET';
  reason: string | null;
};

/** Result of resolving attack-mapped events for a single attack tick. */
export type AttackMappedResolutionEntry = {
  eventType: string;
  /** The attack tick in the merged timeline that candidates resolved to. */
  attackTick: number;
  strategy: ResolutionStrategy['strategy'];
  candidates: AttackMappedCandidate[];
  /** Tick in the merged timeline where the resolved event was placed. */
  resolvedTick: number;
  outcome:
    | 'RESOLVED'
    | 'CONFLICT_RESOLVED'
    | 'CONFLICT_UNEXPECTED'
    | 'CONFLICT_DISCARDED';
  reason: string | null;
};

/** An attack-mapped event that was discarded before reaching resolution. */
export type AttackMappedDiscardEntry = {
  /** Human-readable event type name. */
  eventType: string;
  source: 'base' | 'target';
  /** Tick of the event in the source client's timeline. */
  clientTick: number;
  /** The referenced attack tick in client space, null if extraction failed. */
  referencedTick: number | null;
  outcome: 'NO_REFERENCE' | 'UNMAPPED_TICK' | 'ATTACK_NOT_FOUND';
};

/** One side's data in a projectile-ambiguous player attack conflict. */
export type AmbiguousAttackSide = {
  sourceClientId: number;
  primaryPlayer: string;
  attackType: number;
  distance: number;
};

/** Result of resolving a projectile-ambiguous player attack conflict. */
export type AmbiguousAttackResolutionEntry = {
  tick: number;
  attacker: string;
  base: AmbiguousAttackSide;
  target: AmbiguousAttackSide;
  winner: 'base' | 'target';
};

/** Full trace of the stream reconciliation pass. */
export type ReconciliationTrace = {
  /** Stream dedup results, keyed by "eventType:identityKey". */
  stream: Record<string, StreamReconciliationEntry[]>;
  attackMapped: {
    resolved: AttackMappedResolutionEntry[];
    discarded: AttackMappedDiscardEntry[];
  };
  ambiguousAttacks: AmbiguousAttackResolutionEntry[];
};

export type MergeStepMapping = {
  /** Mapping from base client tick to merged tick.. */
  base: Record<number, number>;
  /** Mapping from target client tick to merged tick. */
  target: Record<number, number>;
  /** Tick count of the merged timeline. */
  mergedTickCount: number;
};

export type MergeStepInfo = {
  clientId: number;
  classification: MergeClientClassification;
  status: MergeClientStatus;
  durationMs: number;
  alignment: SerializedAlignmentResult | null;
  mapping: MergeStepMapping | null;
  tickDecisions: TickMergeDecision[];
  reconciliation: ReconciliationTrace | null;
  qualityFlags: QualityFlag[];
};

export const enum TickMergeDecisionType {
  MERGED = 'MERGED',
  FILLED = 'FILLED',
  SKIPPED = 'SKIPPED',
  RETAINED = 'RETAINED',
}

export type TickMergeDecision = {
  tick: number;
  type: TickMergeDecisionType;
  score?: number;
};

export type MergeTrace = {
  inputClients: InputClientInfo[];
  classification: ClassificationInfo;
  mergeSteps: MergeStepInfo[];
  intermediateSnapshots: TickSummary[][];
};

function serializePlayer(state: Readonly<PlayerState>): PlayerSummary {
  return {
    username: state.username,
    source: state.source,
    x: state.x,
    y: state.y,
    isDead: state.isDead,
    attack:
      state.attack !== null
        ? {
            type: state.attack.type,
            weaponId: state.attack.weaponId,
            target: state.attack.target?.roomId ?? null,
          }
        : null,
  };
}

function serializeNpc(roomId: number, state: Readonly<NpcState>): NpcSummary {
  return {
    roomId,
    id: state.id,
    x: state.x,
    y: state.y,
    hitpoints: {
      current: state.hitpoints.getCurrent(),
      base: state.hitpoints.getBase(),
    },
    attack: state.attack
      ? { type: state.attack.type, target: state.attack.target }
      : null,
  };
}

export function serializeTick(tick: TickState): TickSummary {
  const players: PlayerSummary[] = [];
  for (const [, state] of tick.getPlayerStates()) {
    if (state !== null) {
      players.push(serializePlayer(state));
    }
  }

  const npcs: NpcSummary[] = [];
  for (const [roomId, state] of tick.getNpcs()) {
    npcs.push(serializeNpc(roomId, state));
  }

  const eventCounts: Record<string, number> = {};
  for (const event of tick.getEvents()) {
    const typeName = eventTypeName(event.getType());
    eventCounts[typeName] = (eventCounts[typeName] ?? 0) + 1;
  }

  return { tick: tick.getTick(), players, npcs, eventCounts };
}

export function serializeTicks(ticks: TickStateArray): TickSummary[] {
  const summaries: TickSummary[] = [];
  for (const tick of ticks) {
    if (tick !== null) {
      summaries.push(serializeTick(tick));
    }
  }
  return summaries;
}

function eventTypeName(type: Event.TypeMap[keyof Event.TypeMap]): string {
  for (const [name, value] of Object.entries(Event.Type)) {
    if (value === type) {
      return name;
    }
  }
  return String(type);
}

export function serializeAlignmentResult(
  result: AlignmentResult,
): SerializedAlignmentResult {
  return {
    alignments: result.alignments,
    coverage: result.coverage,
    gapCount: result.gapCount,
  };
}

function serializeTickMapping(mapping: TickMapping): Record<number, number> {
  const result: Record<number, number> = {};
  for (let i = 0; i < mapping.clientTickCount; i++) {
    const merged = mapping.toMerged(i);
    if (merged !== undefined) {
      result[i] = merged;
    }
  }
  return result;
}

export class MergeTracer {
  private inputClients: InputClientInfo[] = [];
  private classification: ClassificationInfo | null = null;
  private mergeSteps: MergeStepInfo[] = [];
  private intermediateSnapshots: TickSummary[][] = [];
  private accuracyDemotions: number[] = [];

  private currentStep: Partial<MergeStepInfo> | null = null;
  private currentStepStart: bigint = 0n;

  public recordInputClient(
    clientId: number,
    recordedTicks: number,
    accurate: boolean,
    reportedAccurate: boolean,
    spectator: boolean,
    ticks: TickStateArray,
  ): void {
    this.inputClients.push({
      clientId,
      recordedTicks,
      accurate,
      reportedAccurate,
      spectator,
      ticks: serializeTicks(ticks),
    });
  }

  public recordAccuracyDemotion(clientId: number): void {
    this.accuracyDemotions.push(clientId);
  }

  public recordClassification(
    referenceSelection: ReferenceSelection,
    baseClientId: number,
    matchingClientIds: number[],
    mismatchedClientIds: number[],
  ): void {
    this.classification = {
      referenceSelection,
      baseClientId,
      matchingClientIds,
      mismatchedClientIds,
      accuracyDemotions: this.accuracyDemotions,
    };
  }

  public beginMergeStep(
    clientId: number,
    classification: MergeClientClassification,
  ): void {
    this.currentStep = { clientId, classification, tickDecisions: [] };
    this.currentStepStart = process.hrtime.bigint();
  }

  public recordTickDecision(decision: TickMergeDecision): void {
    if (this.currentStep !== null) {
      this.currentStep.tickDecisions!.push(decision);
    }
  }

  public recordAlignment(alignment: AlignmentResult): void {
    if (this.currentStep !== null) {
      this.currentStep.alignment = serializeAlignmentResult(alignment);
    }
  }

  public recordMapping(mapping: MergeMapping): void {
    if (this.currentStep === null) {
      return;
    }
    const base = mapping.getBaseMapping();
    const target = mapping.getTargetMapping();
    const mergedTickCount = mapping.getMergedTickCount();
    if (base === null || target === null || mergedTickCount === null) {
      return;
    }
    this.currentStep.mapping = {
      base: serializeTickMapping(base),
      target: serializeTickMapping(target),
      mergedTickCount,
    };
  }

  public recordStreamResolution(
    eventType: EventType,
    identityKey: string,
    base: { mergedTick: number; clientTick: number } | null,
    target: { mergedTick: number; clientTick: number } | null,
    resolvedTick: number | null,
    outcome: StreamReconciliationEntry['outcome'],
    reason: string | null,
  ): void {
    if (this.currentStep === null) {
      return;
    }
    const reconciliation = this.ensureReconciliation();
    const typeName = eventTypeName(eventType);
    const key = `${typeName}:${identityKey}`;

    reconciliation.stream[key] ??= [];

    const tickGap =
      base !== null && target !== null
        ? Math.abs(base.mergedTick - target.mergedTick)
        : null;

    reconciliation.stream[key].push({
      eventType: typeName,
      identityKey,
      base,
      target,
      resolvedTick,
      tickGap,
      outcome,
      reason,
    });
  }

  public recordAttackMappedResolution(
    eventType: EventType,
    attackTick: number,
    strategy: ResolutionStrategy['strategy'],
    candidates: AttackMappedCandidate[],
    resolvedTick: number,
    outcome: AttackMappedResolutionEntry['outcome'],
    reason: string | null,
  ): void {
    if (this.currentStep === null) {
      return;
    }
    const reconciliation = this.ensureReconciliation();
    reconciliation.attackMapped.resolved.push({
      eventType: eventTypeName(eventType),
      attackTick,
      strategy,
      candidates,
      resolvedTick,
      outcome,
      reason,
    });
  }

  public recordAttackMappedDiscard(
    eventType: EventType,
    source: 'base' | 'target',
    clientTick: number,
    referencedTick: number | null,
    outcome: AttackMappedDiscardEntry['outcome'],
  ): void {
    if (this.currentStep === null) {
      return;
    }
    const reconciliation = this.ensureReconciliation();
    reconciliation.attackMapped.discarded.push({
      eventType: eventTypeName(eventType),
      source,
      clientTick,
      referencedTick,
      outcome,
    });
  }

  public recordAmbiguousAttackResolution(
    entry: AmbiguousAttackResolutionEntry,
  ): void {
    if (this.currentStep === null) {
      return;
    }
    const reconciliation = this.ensureReconciliation();
    reconciliation.ambiguousAttacks.push(entry);
  }

  public recordQualityFlags(flags: QualityFlag[]): void {
    if (this.currentStep !== null) {
      this.currentStep.qualityFlags = flags;
    }
  }

  private ensureReconciliation(): ReconciliationTrace {
    if (this.currentStep!.reconciliation === undefined) {
      this.currentStep!.reconciliation = {
        stream: {},
        attackMapped: { resolved: [], discarded: [] },
        ambiguousAttacks: [],
      };
    }
    return this.currentStep!.reconciliation!;
  }

  public endMergeStep(status: MergeClientStatus): void {
    if (this.currentStep === null) {
      return;
    }

    const durationMs =
      Number(process.hrtime.bigint() - this.currentStepStart) / 1_000_000;

    this.mergeSteps.push({
      clientId: this.currentStep.clientId!,
      classification: this.currentStep.classification!,
      status,
      durationMs,
      alignment: this.currentStep.alignment ?? null,
      mapping: this.currentStep.mapping ?? null,
      tickDecisions: this.currentStep.tickDecisions!,
      reconciliation: this.currentStep.reconciliation ?? null,
      qualityFlags: this.currentStep.qualityFlags ?? [],
    });

    this.currentStep = null;
  }

  public recordIntermediateSnapshot(ticks: TickStateArray): void {
    this.intermediateSnapshots.push(serializeTicks(ticks));
  }

  public toTrace(): MergeTrace {
    if (this.classification === null) {
      throw new Error('Cannot build trace without classification');
    }

    return {
      inputClients: this.inputClients,
      classification: this.classification,
      mergeSteps: this.mergeSteps,
      intermediateSnapshots: this.intermediateSnapshots,
    };
  }
}
