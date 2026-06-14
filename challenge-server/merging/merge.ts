import { Npc, SkillLevel, Stage, StageStatus } from '@blert/common';
import { Event } from '@blert/common/generated/event_pb';
import { ChallengeEvents } from '@blert/common/generated/challenge_storage_pb';

import { AlignmentResult, TickAligner } from './alignment';
import {
  ClassifiedClients,
  classifyClients,
  ReferenceSelection,
  ReferenceSelectionMethod,
} from './classification';
import {
  ClientAnomaly,
  ClientEvents,
  ClientMetadata,
  ServerTicks,
} from './client-events';
import { ConsistencyIssue } from './client-consistency';
import {
  DEFAULT_CONFIDENCE_WEIGHTS,
  scoreStepConfidence,
  StepConfidence,
} from './confidence';
import {
  ChallengeInfo,
  MergeClientStatus,
  MergeContext,
  RegisteredClient,
} from './context';
import { derivedEventGeneratorForStage, mergeStageData } from './derivation';
import { remapEventTick } from './event';
import { EventConsolidator } from './event-consolidator';
import logger from '../log';
import {
  MergeConsistencyChecker,
  MergeConsistencyIssue,
  RejectionReason,
  StepRejection,
} from './merge-consistency';

import { MergeAlert, MergeAlertType, QualityFlag } from './quality';
import {
  DEFAULT_BASELINE_COMPATIBILITY_WEIGHT,
  SimilarityScorer,
} from './similarity-scorer';
import { Mappings, MergeMapping, TickMapping } from './tick-mapping';
import { resynchronizeTicks, TickState, TickStateArray } from './tick-state';
import { MergeTracer } from './trace';
import {
  computeTrustedPrefixes,
  recordContestedTicks,
  TrustedPrefixes,
} from './trusted-prefixes';

// Provisional confidence acceptance threshold.
// TODO(frolv): Calibrate against real data and consider if it should look at
// individual components instead of a flat threshold.
const MIN_MERGE_CONFIDENCE_THRESHOLD = 0.75;

// Worst-segment score below which a merged client is flagged for review.
const LOW_CONFIDENCE_WARN_THRESHOLD = 0.4;

export const enum MergeClientClassification {
  /** The client was selected as the reference client. */
  REFERENCE = 'REFERENCE',

  /** The client was classified as matching. */
  MATCHING = 'MATCHING',

  /** The client was classified as mismatched. */
  MISMATCHED = 'MISMATCHED',
}

export type MergeClient = {
  id: number;
  primaryPlayer: string | null;
  /** Connection metadata reported by the client, if it sent any. */
  metadata: ClientMetadata | null;
  status: MergeClientStatus;
  classification: MergeClientClassification;
  sequenceNumber: number;
  recordedTicks: number;
  serverTicks: ServerTicks | null;
  reportedAccurate: boolean;
  derivedAccurate: boolean;
  anomalies: ClientAnomaly[];
  consistencyIssues: ConsistencyIssue[];
  qualityFlags: QualityFlag[];
  /**
   * Why this client's merge step was rejected, or `null` if it was not
   * rejected. A client may be `UNMERGED` without a rejection reason when its
   * alignment produced nothing to merge.
   */
  rejectionReason: RejectionReason | null;
  /**
   * Post-merge consistency issues that caused this client's merge step to be
   * rejected. Empty unless `status === MergeClientStatus.UNMERGED` and the
   * rejection came from the post-merge consistency check.
   */
  mergeIssues: MergeConsistencyIssue[];
  /**
   * Lowest segment score from this client's merge-step confidence, or null for
   * the reference client or a step with no scored segments.
   */
  worstSegmentScore: number | null;
};

export type MergeOptions = {
  /**
   * When true, attempt alignment-based merging for mismatched clients.
   * When false (default), mismatched clients are skipped.
   */
  alignMismatched?: boolean;
};

const DEFAULT_MERGE_OPTIONS: MergeOptions = {
  alignMismatched: false,
};

export type MergeResult = {
  events: MergedEvents;
  clients: MergeClient[];
  mergedCount: number;
  unmergedCount: number;
  skippedCount: number;
  alerts: MergeAlert[];
  referenceSelection: ReferenceSelection;
};

function surfaceAlerts(mergeClients: MergeClient[]): MergeAlert[] {
  const alerts: MergeAlert[] = [];
  const rejected = mergeClients.filter((c) => c.mergeIssues.length > 0);
  if (rejected.length > 0) {
    alerts.push({
      type: MergeAlertType.POST_MERGE_CONSISTENCY_REJECTIONS,
      details: {
        rejectedClientIds: rejected.map((c) => c.id),
        totalIssues: rejected.reduce((sum, c) => sum + c.mergeIssues.length, 0),
      },
    });
  }

  const confidenceRejected = mergeClients.filter(
    (c) => c.rejectionReason === RejectionReason.LOW_MERGE_CONFIDENCE,
  );
  if (confidenceRejected.length > 0) {
    alerts.push({
      type: MergeAlertType.LOW_CONFIDENCE_REJECTIONS,
      details: { rejectedClientIds: confidenceRejected.map((c) => c.id) },
    });
  }

  const lowConfidence = mergeClients.filter(
    (c) =>
      c.status === MergeClientStatus.MERGED &&
      c.worstSegmentScore !== null &&
      c.worstSegmentScore < LOW_CONFIDENCE_WARN_THRESHOLD,
  );
  if (lowConfidence.length > 0) {
    alerts.push({
      type: MergeAlertType.LOW_STRUCTURAL_CONFIDENCE,
      details: {
        clientIds: lowConfidence.map((c) => c.id),
        worstSegmentScores: lowConfidence.map((c) => c.worstSegmentScore),
      },
    });
  }
  return alerts;
}

function createMergeClient(
  client: ClientEvents,
  classification: MergeClientClassification,
  status: MergeClientStatus,
  sequenceNumber: number,
  qualityFlags: QualityFlag[] = [],
  rejectionReason: RejectionReason | null = null,
  mergeIssues: MergeConsistencyIssue[] = [],
  confidence: StepConfidence | null = null,
): MergeClient {
  const worstIdx = confidence?.structural.worstSegmentIdx ?? null;
  const worstSegmentScore =
    confidence !== null && worstIdx !== null
      ? confidence.structural.segments[worstIdx].score
      : null;
  return {
    id: client.getId(),
    primaryPlayer: client.getPrimaryPlayer(),
    metadata: client.getMetadata(),
    status,
    classification,
    sequenceNumber,
    recordedTicks: client.getFinalTick(),
    serverTicks: client.getServerTicks(),
    reportedAccurate: client.getReportedAccurate(),
    derivedAccurate: client.isAccurate(),
    anomalies: client.getAnomalies(),
    consistencyIssues: client.getConsistencyIssues(),
    qualityFlags,
    rejectionReason,
    mergeIssues,
    worstSegmentScore,
  };
}

export class Merger {
  private readonly challenge: ChallengeInfo;
  private readonly stage: Stage;
  private readonly alerts: MergeAlert[];
  private clients: ClientEvents[];
  private referenceSelection: ReferenceSelection | null;

  public constructor(
    challenge: ChallengeInfo,
    stage: Stage,
    clients: ClientEvents[],
  ) {
    this.challenge = challenge;
    this.stage = stage;
    this.clients = clients.toSorted(
      (a, b) => b.getFinalTick() - a.getFinalTick() || a.getId() - b.getId(),
    );
    this.alerts = [];
    this.referenceSelection = null;
  }

  public merge(
    tracer?: MergeTracer,
    options?: MergeOptions,
  ): MergeResult | null {
    const mergeOptions = { ...DEFAULT_MERGE_OPTIONS, ...options };

    if (this.clients.length === 0) {
      logger.warn('merge_no_clients', { stage: this.stage });
      return null;
    }

    logger.debug('merge_start', {
      stage: this.stage,
      clientMetadata: this.clients.map((c) => ({
        id: c.getId(),
        tickCount: c.getTickCount(),
        accurate: c.isAccurate(),
      })),
    });

    // Record input clients before classification may demote accuracy.
    const registeredClients = new Map<number, RegisteredClient>();
    for (const client of this.clients) {
      registeredClients.set(client.getId(), {
        client,
        status: MergeClientStatus.UNMERGED,
      });
      tracer?.recordInputClient(
        client.getId(),
        client.getPrimaryPlayer(),
        client.getMetadata(),
        client.getTickCount(),
        client.isAccurate(),
        client.getReportedAccurate(),
        client.getTickStates(),
        client.getStageData(),
      );
    }

    const mergeClients: MergeClient[] = [];

    const badDataClients = this.clients.filter((c) =>
      c.hasAnomaly(ClientAnomaly.BAD_DATA),
    );
    this.clients = this.clients.filter(
      (c) => !c.hasAnomaly(ClientAnomaly.BAD_DATA),
    );
    if (this.clients.length === 0) {
      logger.warn('merge_all_clients_bad_data', {
        stage: this.stage,
        clientIds: badDataClients.map((c) => c.getId()),
      });
      return null;
    }

    const clients = this.classifyAndUpdateClients(tracer);
    this.referenceSelection = clients.referenceTicks;

    const ctx: MergeContext = {
      challenge: this.challenge,
      stage: this.stage,
      clients: registeredClients,
      mapping: new MergeMapping(clients.base.getId()),
      contestedTicks: new Map(),
      tracer,
    };

    ctx.tracer?.recordClassification(
      clients.referenceTicks,
      clients.base.getId(),
      clients.matching.map((c) => c.getId()),
      clients.mismatched.map((c) => c.getId()),
    );

    const recordMergeResult = (
      client: ClientEvents,
      classification: MergeClientClassification,
      outcome: MergeStepOutcome,
    ) => {
      const status = statusFromOutcome(outcome);
      const rejection = outcome.kind === 'rejected' ? outcome.rejection : null;
      const confidence = outcome.kind === 'merged' ? outcome.confidence : null;
      mergeClients.push(
        createMergeClient(
          client,
          classification,
          status,
          mergeClients.length,
          outcome.flags,
          rejection?.reason ?? null,
          rejection?.issues ?? [],
          confidence,
        ),
      );
      ctx.clients.get(client.getId())!.status = status;
    };

    recordMergeResult(clients.base, MergeClientClassification.REFERENCE, {
      kind: 'merged',
      flags: [],
      confidence: null,
    });

    const merged = new MergedTimeline(
      clients.base,
      ctx,
      clients.referenceTicks,
    );

    // Record the initial state (base client only) as the first snapshot.
    ctx.tracer?.recordIntermediateSnapshot(merged.getTicks());

    const mergeFrom = (
      client: ClientEvents,
      classification: MergeClientClassification,
    ) => {
      ctx.tracer?.beginMergeStep(client.getId(), classification);

      let outcome: MergeStepOutcome;
      try {
        outcome = merged.mergeEventsFrom(client, mergeOptions);
        if (outcome.kind === 'merged') {
          ctx.tracer?.recordIntermediateSnapshot(merged.getTicks());
        } else if (outcome.kind === 'rejected') {
          ctx.tracer?.recordStepRejection(outcome.rejection);
          logger.warn('merge_step_rejected', {
            stage: this.stage,
            clientId: client.getId(),
            reason: outcome.rejection.reason,
            issueCount: outcome.rejection.issues.length,
          });
        }
      } catch (e) {
        logger.error('merge_client_error', {
          stage: this.stage,
          clientId: client.getId(),
          error: e instanceof Error ? e.message : String(e),
          stack: e instanceof Error ? e.stack : undefined,
        });
        outcome = { kind: 'unmerged', flags: [] };
      }

      ctx.tracer?.endMergeStep(statusFromOutcome(outcome));
      recordMergeResult(client, classification, outcome);
    };

    for (const client of clients.matching) {
      mergeFrom(client, MergeClientClassification.MATCHING);
    }

    for (const client of clients.mismatched) {
      mergeFrom(client, MergeClientClassification.MISMATCHED);
    }

    for (const client of badDataClients) {
      recordMergeResult(client, MergeClientClassification.MISMATCHED, {
        kind: 'skipped',
        flags: [],
      });
    }

    merged.finalizeMerge();

    const appliedOffset = merged.getAppliedOffset();
    if (appliedOffset > 0) {
      logger.warn('merge_timeline_offset_applied', {
        stage: this.stage,
        offset: appliedOffset,
        referenceCount: clients.referenceTicks.count,
      });
      this.alerts.push({
        type: MergeAlertType.TIMELINE_OFFSET_APPLIED,
        details: {
          offset: appliedOffset,
          referenceCount: clients.referenceTicks.count,
        },
      });

      // In the rare case where the base client left before stage end and the
      // only stream that saw the end was rejected, the merged timeline will not
      // match the reference count. End alignment will then shift the timeline
      // even though base tick 0 may have been the true stage tick 0. Log it for
      // traceability into whether this ever actually occurs.
      const endSeenByContributor = mergeClients.some(
        (c) => c.status === MergeClientStatus.MERGED && c.serverTicks !== null,
      );
      if (!endSeenByContributor) {
        logger.warn('merge_offset_no_merged_end_stream', {
          stage: this.stage,
          offset: appliedOffset,
          referenceCount: clients.referenceTicks.count,
        });
      }
    }

    const { mergedCount, unmergedCount, skippedCount } =
      this.getMergeCounts(mergeClients);

    merged.postprocess(this.stage);

    const mergedEvents = merged.toMergedEvents();

    this.alerts.push(...surfaceAlerts(mergeClients));

    logger.info('merge_result', {
      mergedCount,
      unmergedCount,
      skippedCount,
      alerts: this.alerts,
      referenceSelection: this.referenceSelection,
      accurateUntil: mergedEvents.accurateUntil(),
      queryableUntil: mergedEvents.queryableUntil(),
    });

    return {
      events: mergedEvents,
      clients: mergeClients,
      mergedCount,
      unmergedCount,
      skippedCount,
      alerts: this.alerts,
      referenceSelection: this.referenceSelection,
    };
  }

  private getReferenceTicks(): number | null {
    return this.referenceSelection?.count ?? null;
  }

  private getMergeCounts(clients: MergeClient[]): {
    mergedCount: number;
    unmergedCount: number;
    skippedCount: number;
  } {
    let mergedCount = 0;
    let unmergedCount = 0;
    let skippedCount = 0;

    for (const client of clients) {
      switch (client.status) {
        case MergeClientStatus.MERGED:
          mergedCount++;
          break;
        case MergeClientStatus.UNMERGED:
          unmergedCount++;
          break;
        case MergeClientStatus.SKIPPED:
          skippedCount++;
          break;
      }
    }

    return { mergedCount, unmergedCount, skippedCount };
  }

  private classifyAndUpdateClients(
    tracer: MergeTracer | undefined,
  ): ClassifiedClients {
    let accuracyConflict = false;
    const accurateClients = this.clients.filter((c) => c.isAccurate());

    if (accurateClients.length > 0) {
      const counts = new Map<number, number>();
      let maxCount = 0;
      for (const client of accurateClients) {
        const k = client.getFinalTick();
        const count = (counts.get(k) ?? 0) + 1;
        counts.set(k, count);
        if (count > maxCount) {
          maxCount = count;
        }
      }

      const modes = [...counts.keys()].filter(
        (k) => counts.get(k) === maxCount,
      );

      if (modes.length > 1) {
        accuracyConflict = true;

        const tickCounts = modes.toSorted((a, b) => a - b);
        logger.warn('merge_multiple_accurate_tick_modes', {
          stage: this.stage,
          tickCounts,
        });
        this.alerts.push({
          type: MergeAlertType.MULTIPLE_ACCURATE_TICK_MODES,
          details: { tickCounts },
        });
        for (const client of accurateClients) {
          client.setAccurate(false);
          tracer?.recordAccuracyDemotion(client.getId());
        }
      } else {
        // Single mode. Demote any "accurate" clients that don't match.
        const modalTicks = modes[0];
        for (const client of accurateClients) {
          if (client.isAccurate() && client.getFinalTick() !== modalTicks) {
            logger.warn('merge_client_accuracy_mismatch', {
              stage: this.stage,
              client: client.getId(),
              expectedTicks: modalTicks,
              actualTicks: client.getFinalTick(),
            });
            client.setAccurate(false);
            tracer?.recordAccuracyDemotion(client.getId());
          }
        }
      }
    }

    const clients = classifyClients(this.clients);

    if (!accuracyConflict) {
      // Flag any server tick count disagreements.
      const serverTickCounts = clients.referenceTicks.details?.serverTickCounts;
      if (Array.isArray(serverTickCounts) && serverTickCounts.length > 1) {
        logger.warn('merge_multiple_server_tick_counts', {
          stage: this.stage,
          method: clients.referenceTicks.method,
          counts: serverTickCounts,
        });
        this.alerts.push({
          type: MergeAlertType.MULTIPLE_SERVER_TICK_COUNTS,
          details: {
            method: clients.referenceTicks.method,
            counts: serverTickCounts,
          },
        });
      }
    }

    return clients;
  }
}

type MergeStepOutcomeType =
  | { kind: 'merged'; confidence: StepConfidence | null }
  | { kind: 'unmerged' }
  | { kind: 'skipped' }
  | { kind: 'rejected'; rejection: StepRejection };
type MergeStepOutcome = MergeStepOutcomeType & { flags: QualityFlag[] };

function statusFromOutcome(outcome: MergeStepOutcome): MergeClientStatus {
  switch (outcome.kind) {
    case 'merged':
      return MergeClientStatus.MERGED;
    case 'skipped':
      return MergeClientStatus.SKIPPED;
    case 'unmerged':
    case 'rejected':
      return MergeClientStatus.UNMERGED;
  }
}

type MergedEventsMetadata = {
  status: StageStatus;
  lastTick: number;
  missingTickCount: number;
  preciseServerTickCount: boolean;
  accurateUntil: number;
  queryableUntil: number;
};

type SerializedMergedEvents = {
  events: string;
  metadata: MergedEventsMetadata;
};

export class MergedEvents {
  private byTick: Map<number, Event[]> | null = null;

  constructor(
    private readonly flatEvents: Event[],
    private readonly metadata: MergedEventsMetadata,
  ) {}

  [Symbol.iterator](): Iterator<Event> {
    return this.flatEvents[Symbol.iterator]();
  }

  public eventsForTick(tick: number): Event[] {
    if (this.byTick === null) {
      this.byTick = new Map();
      for (const event of this.flatEvents) {
        const t = event.getTick();
        const bucket = this.byTick.get(t);
        if (bucket === undefined) {
          this.byTick.set(t, [event]);
        } else {
          bucket.push(event);
        }
      }
    }
    return this.byTick.get(tick) ?? [];
  }

  public getStatus(): StageStatus {
    return this.metadata.status;
  }

  public getLastTick(): number {
    return this.metadata.lastTick;
  }

  public getMissingTickCount(): number {
    return this.metadata.missingTickCount;
  }

  public hasPreciseServerTickCount(): boolean {
    return this.metadata.preciseServerTickCount;
  }

  /**
   * The exclusive tick at which the merged timeline can no longer be trusted to
   * match the true server tick count.
   */
  public accurateUntil(): number {
    return this.metadata.accurateUntil;
  }

  /** Whether accuracy covers the entire stage. */
  public fullyAccurate(): boolean {
    return this.metadata.lastTick < this.metadata.accurateUntil;
  }

  /**
   * The exclusive tick at which the merged event stream can no longer be fully
   * corroborated for strict analysis.
   */
  public queryableUntil(): number {
    return this.metadata.queryableUntil;
  }

  /** Whether queryability covers the entire stage. */
  public fullyQueryable(): boolean {
    return this.metadata.lastTick < this.metadata.queryableUntil;
  }

  /**
   * Limits the accuracy and queryability of the event stream to the given tick.
   * @param tick Exclusive tick to which to restrict trust.
   */
  public restrictAccuracyTo(tick: number): void {
    this.metadata.accurateUntil = Math.min(this.metadata.accurateUntil, tick);
    this.metadata.queryableUntil = Math.min(this.metadata.queryableUntil, tick);
  }

  public serialize(): string {
    const wrapper = new ChallengeEvents();
    wrapper.setEventsList(this.flatEvents);
    return JSON.stringify({
      events: Buffer.from(wrapper.serializeBinary()).toString('base64'),
      metadata: this.metadata,
    });
  }

  public static deserialize(serialized: string): MergedEvents {
    const { events, metadata } = JSON.parse(
      serialized,
    ) as SerializedMergedEvents;
    const wrapper = ChallengeEvents.deserializeBinary(
      Buffer.from(events, 'base64'),
    );
    return new MergedEvents(wrapper.getEventsList(), metadata);
  }
}

class MergedTimeline {
  private ticks!: TickStateArray;
  private readonly status: StageStatus;
  private readonly ctx: MergeContext;
  private readonly reference: ReferenceSelection;
  private readonly preciseServerTickCount: boolean;
  private readonly inheritedAccurate: boolean;
  private trustedPrefixes: TrustedPrefixes | null;
  private finalized: boolean;
  private appliedOffset: number;

  constructor(
    base: ClientEvents,
    ctx: MergeContext,
    reference: ReferenceSelection,
  ) {
    this.status = base.getStatus();
    this.ctx = ctx;
    this.reference = reference;
    this.preciseServerTickCount =
      reference.method === ReferenceSelectionMethod.PRECISE_SERVER ||
      reference.method === ReferenceSelectionMethod.ACCURATE_MODAL;
    this.inheritedAccurate = base.isAccurate();

    this.finalized = false;
    this.appliedOffset = 0;
    this.trustedPrefixes = null;

    this.initializeBaseTicks(base);
  }

  [Symbol.iterator](): EventIterator {
    if (!this.finalized) {
      throw new Error('Merge not finalized');
    }
    return new EventIterator(this.ticks);
  }

  public getTicks(): TickStateArray {
    return [...this.ticks];
  }

  public toMergedEvents(): MergedEvents {
    if (!this.finalized) {
      throw new Error('Merge not finalized');
    }
    return new MergedEvents(Array.from(this), {
      status: this.status,
      lastTick: this.ticks.length - 1,
      missingTickCount: this.ticks.filter((tick) => tick === null).length,
      preciseServerTickCount: this.preciseServerTickCount,
      accurateUntil: this.trustedPrefixes?.accurateUntil ?? 0,
      queryableUntil: this.trustedPrefixes?.queryableUntil ?? 0,
    });
  }

  /**
   * Merges events from `client` into this merged event set.
   *
   * @param client Client to merge events from.
   * @param options Merge options controlling alignment behavior.
   * @returns A tagged outcome describing what happened.
   */
  public mergeEventsFrom(
    client: ClientEvents,
    options: MergeOptions,
  ): MergeStepOutcome {
    const targetTicks = client.getTickStates();
    let mappings: Mappings;
    let alignment: AlignmentResult | null = null;

    if (this.inheritedAccurate && client.isAccurate()) {
      // Accurate clients use identity mapping.
      mappings = {
        base: TickMapping.identity(this.ticks.length),
        target: TickMapping.identity(targetTicks.length),
        mergedTickCount: this.ticks.length,
      };
    } else {
      if (!options.alignMismatched) {
        return { kind: 'unmerged', flags: [] };
      }
      alignment = this.runAlignment(client);
      if (alignment === null || alignment.alignments.length === 0) {
        // The aligner found no alignable regions; nothing to merge.
        return { kind: 'unmerged', flags: [] };
      }
      mappings = TickMapping.fromAlignment(
        this.ticks.length,
        targetTicks.length,
        alignment.alignments.map((a) => a.entries),
      );
    }

    this.ctx.mapping.begin(client.getId(), mappings);
    this.ctx.tracer?.recordMapping(this.ctx.mapping);

    try {
      const consolidator = new EventConsolidator(
        this.ticks,
        targetTicks,
        this.ctx,
      );
      const result = consolidator.consolidate();

      const confidence = scoreStepConfidence(
        alignment,
        result.counters,
        result.qualityFlags,
        DEFAULT_CONFIDENCE_WEIGHTS,
        DEFAULT_BASELINE_COMPATIBILITY_WEIGHT,
      );
      this.ctx.tracer?.recordConfidence(confidence);

      const consistencyChecker = new MergeConsistencyChecker(this.ctx);
      const issues = consistencyChecker.check(result.ticks);

      const lowConfidence = confidence.overall < MIN_MERGE_CONFIDENCE_THRESHOLD;
      if (issues.length > 0 || lowConfidence) {
        this.ctx.mapping.discard();
        return {
          kind: 'rejected',
          flags: result.qualityFlags,
          rejection: {
            reason:
              issues.length > 0
                ? RejectionReason.POST_MERGE_CONSISTENCY
                : RejectionReason.LOW_MERGE_CONFIDENCE,
            issues,
          },
        };
      }

      this.ctx.mapping.commit();
      recordContestedTicks(this.ctx, client.getId(), result.qualityFlags);

      this.ticks = result.ticks;
      return { kind: 'merged', flags: result.qualityFlags, confidence };
    } catch (e) {
      this.ctx.mapping.discard();
      throw e;
    }
  }

  /**
   * Commits the base event timeline of the merge.
   */
  public finalizeMerge(): void {
    if (this.finalized) {
      return;
    }
    this.endAlignToReference();
    resynchronizeTicks(this.ctx.stage, this.ticks);

    const derivedEvents = derivedEventGeneratorForStage(
      this.ctx.stage,
      this.ctx.challenge.mode,
    );
    derivedEvents?.derive(this.ticks);

    mergeStageData(this.ctx, this.ticks);

    const trustedPrefixes = computeTrustedPrefixes(this.ctx, {
      totalTicks: this.ticks.length,
      offset: this.appliedOffset,
      inheritedAccuracy: this.inheritedAccurate,
      referenceMethod: this.reference.method,
    });
    this.trustedPrefixes = trustedPrefixes;
    this.ctx.tracer?.recordTrustedPrefixes(trustedPrefixes);

    this.finalized = true;
  }

  /**
   * The number of leading ticks the merged timeline was shifted by to align
   * with the reference count. Nonzero means that empty ticks were inserted at
   * the start.
   */
  public getAppliedOffset(): number {
    return this.appliedOffset;
  }

  private endAlignToReference(): void {
    // If a client reported an in-game tick count, the stage has been completed,
    // so assume that the events are offset from the end of the stage.
    if (this.reference.method === ReferenceSelectionMethod.RECORDED_TICKS) {
      return;
    }

    const lastTick = this.ticks.length - 1;
    const offset = this.reference.count - lastTick;
    if (offset <= 0) {
      return;
    }

    this.appliedOffset = offset;
    logger.debug('merge_end_align', {
      offset,
      referenceCount: this.reference.count,
      mergedTicks: lastTick + 1,
    });

    const remap = (tick: number): number => tick + offset;
    const shifted = Array<TickState | null>(this.reference.count + 1).fill(
      null,
    );
    for (let i = 0; i <= lastTick; i++) {
      const state = this.ticks[i];
      if (state === null) {
        continue;
      }
      const newTick = remap(i);
      const events = state
        .getTaggedEvents()
        .map((t) => remapEventTick(t, remap));
      shifted[newTick] = new TickState(
        newTick,
        events,
        new Map(state.getPlayerStates()),
        new Map(state.getNpcs()),
        new Map(state.getGraphics()),
      );
    }
    this.ticks = shifted;
  }

  /**
   * Applies post-merge corrections to the event set.
   * @param stage Stage that the events are being merged for.
   */
  public postprocess(stage: Stage): void {
    if (!this.finalized) {
      throw new Error('Merge not finalized');
    }

    if (stage === Stage.TOB_MAIDEN) {
      this.correctOffsetMaidenSpawn();
    }
  }

  private runAlignment(client: ClientEvents): AlignmentResult | null {
    const scorer = new SimilarityScorer();
    const aligner = new TickAligner(
      this.ticks,
      client.getTickStates(),
      (a, b) => scorer.score(a, b),
    );
    const alignment = aligner.align();
    this.ctx.tracer?.recordAlignment(alignment);
    return alignment;
  }

  private initializeBaseTicks(base: ClientEvents): void {
    this.ticks = Array<TickState | null>(base.getFinalTick() + 1).fill(null);
    for (let i = 0; i <= base.getFinalTick(); i++) {
      this.ticks[i] = base.getTickState(i)?.clone() ?? null;
    }
  }

  private correctOffsetMaidenSpawn(): void {
    // On 2025-02-18, a RuneScape update limited clients to receiving events
    // from only actors that were rendered, rather than all actors in an
    // instance. This is likely to manifest in many ways, but the first known
    // issue is that Maiden only appears two ticks into the room from an
    // entering player's perspective.
    //
    // Correct this by moving Maiden's spawn event to the start of the stage and
    // inserting fake NPC update events during the missing ticks. Fortunately,
    // Maiden can't be attacked during this time, so we can just set her HP to
    // 100%.
    let firstMaidenEvent: Event | null = null;
    for (const event of this) {
      if (event.getType() === Event.Type.NPC_SPAWN) {
        const npc = event.getNpc()!;
        if (Npc.isMaiden(npc.getId())) {
          firstMaidenEvent = event;
          break;
        }
      }
    }

    if (firstMaidenEvent === null) {
      return;
    }

    const tick = firstMaidenEvent.getTick();
    const maidenNpc = firstMaidenEvent.getNpc()!;
    const hitpoints = SkillLevel.fromRaw(maidenNpc.getHitpoints());

    // Confirm that Maiden is at full HP to try to avoid the case where the
    // client has lost ticks and recorded tick 2 isn't actually the second tick.
    if (tick !== 2 || hitpoints.getCurrent() !== hitpoints.getBase()) {
      return;
    }

    const tickState = this.ticks[tick];
    if (tickState === null) {
      return;
    }

    const maidenSpawn = firstMaidenEvent;
    if (!tickState.removeEvent(maidenSpawn)) {
      return;
    }

    // On the affected tick, change the NPC spawn event to an NPC update.
    const updateEvent = maidenSpawn.clone();
    updateEvent.setType(Event.Type.NPC_UPDATE);
    tickState.addSyntheticEvents([updateEvent]);

    maidenSpawn.setTick(0);

    // Add the appropriate NPC events for the initial ticks of the stage.
    for (let i = 0; i < tick; i++) {
      const state = this.ticks[i];
      if (state === null) {
        continue;
      }

      let newEvent: Event;
      if (i === 0) {
        newEvent = maidenSpawn;
      } else {
        newEvent = updateEvent.clone();
        newEvent.setTick(i);
      }

      state.addSyntheticEvents([newEvent]);
    }
  }
}

class EventIterator implements Iterator<Event, Event | null> {
  private readonly ticks: (TickState | null)[];
  private tick: number;
  private eventIndex: number;

  constructor(ticks: (TickState | null)[]) {
    this.ticks = ticks;
    this.tick = 0;
    this.eventIndex = 0;
  }

  public next(): IteratorResult<Event, Event | null> {
    for (; this.tick < this.ticks.length; this.tick++) {
      if (this.ticks[this.tick] === null) {
        this.eventIndex = 0;
        continue;
      }

      const tickEvents = this.ticks[this.tick]!.getEvents();
      while (this.eventIndex < tickEvents.length) {
        return {
          done: false,
          value: tickEvents[this.eventIndex++],
        };
      }

      this.eventIndex = 0;
    }

    return { done: true, value: null };
  }
}
