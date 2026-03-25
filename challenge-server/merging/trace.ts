import { DataSource } from '@blert/common';
import { Event } from '@blert/common/generated/event_pb';

import { AlignmentResult, LocalAlignment } from './alignment';
import { ReferenceSelection } from './classification';
import { MergeClientClassification, MergeClientStatus } from './merge';
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

export type MergeStepInfo = {
  clientId: number;
  classification: MergeClientClassification;
  status: MergeClientStatus;
  durationMs: number;
  alignment: SerializedAlignmentResult | null;
  tickDecisions: TickMergeDecision[];
};

export const enum TickMergeDecisionType {
  MERGED = 'MERGED',
  FILLED = 'FILLED',
  SKIPPED = 'SKIPPED',
}

export type TickMergeDecision = {
  tick: number;
  type: TickMergeDecisionType;
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
    attack: state.attack
      ? {
          type: state.attack.type,
          weaponId: state.attack.weaponId,
          target: state.attack.target,
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
      tickDecisions: this.currentStep.tickDecisions!,
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
