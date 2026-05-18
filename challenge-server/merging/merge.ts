import { Npc, SkillLevel, Stage, StageStatus } from '@blert/common';
import { Event } from '@blert/common/generated/event_pb';

import { AlignmentResult, TickAligner } from './alignment';
import {
  ClassifiedClients,
  classifyClients,
  ReferenceSelection,
} from './classification';
import { ClientAnomaly, ClientEvents, ServerTicks } from './client-events';
import { ConsistencyIssue } from './client-consistency';
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

import { MergeAlert, MergeAlertType } from './quality';
import { SimilarityScorer } from './similarity-scorer';
import { MergeMapping, TickMapping } from './tick-mapping';
import { resynchronizeTicks, TickState, TickStateArray } from './tick-state';
import { MergeTracer } from './trace';

const MIN_ALIGNMENT_COVERAGE = 0.5;

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
  status: MergeClientStatus;
  classification: MergeClientClassification;
  sequenceNumber: number;
  recordedTicks: number;
  serverTicks: ServerTicks | null;
  reportedAccurate: boolean;
  derivedAccurate: boolean;
  anomalies: ClientAnomaly[];
  consistencyIssues: ConsistencyIssue[];
  /**
   * Post-merge consistency issues that caused this client's merge step to be
   * rejected. Empty unless `status === MergeClientStatus.UNMERGED` and the
   * rejection came from the post-merge consistency check.
   */
  mergeIssues: MergeConsistencyIssue[];
  // TODO(frolv): Add alignment information if available.
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
  return alerts;
}

function createMergeClient(
  client: ClientEvents,
  classification: MergeClientClassification,
  status: MergeClientStatus,
  sequenceNumber: number,
  mergeIssues: MergeConsistencyIssue[] = [],
): MergeClient {
  return {
    id: client.getId(),
    primaryPlayer: client.getPrimaryPlayer(),
    status,
    classification,
    sequenceNumber,
    recordedTicks: client.getFinalTick(),
    serverTicks: client.getServerTicks(),
    reportedAccurate: client.getReportedAccurate(),
    derivedAccurate: client.isAccurate(),
    anomalies: client.getAnomalies(),
    consistencyIssues: client.getConsistencyIssues(),
    mergeIssues,
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
      (a, b) => b.getFinalTick() - a.getFinalTick(),
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
      logger.warn('merge_no_clients', { stage: this.stage });
      return null;
    }

    const clients = this.classifyAndUpdateClients(tracer);
    this.referenceSelection = clients.referenceTicks;

    const ctx: MergeContext = {
      challenge: this.challenge,
      stage: this.stage,
      clients: registeredClients,
      mapping: new MergeMapping(clients.base.getId()),
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
      const mergeIssues =
        outcome.kind === 'rejected' ? outcome.rejection.issues : [];
      mergeClients.push(
        createMergeClient(
          client,
          classification,
          status,
          mergeClients.length,
          mergeIssues,
        ),
      );
      ctx.clients.get(client.getId())!.status = status;
    };

    recordMergeResult(clients.base, MergeClientClassification.REFERENCE, {
      kind: 'merged',
    });

    const merged = new MergedEvents(clients.base, ctx);

    // Record the initial state (base client only) as the first snapshot.
    ctx.tracer?.recordIntermediateSnapshot(merged.getTicks());

    const mergeFrom = (
      client: ClientEvents,
      classification: MergeClientClassification,
    ) => {
      ctx.tracer?.beginMergeStep(client.getId(), classification);

      let outcome: MergeStepOutcome = { kind: 'unmerged' };
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
      });
    }

    merged.finalizeMerge();

    const { mergedCount, unmergedCount, skippedCount } =
      this.getMergeCounts(mergeClients);

    merged.postprocess(this.stage);

    this.alerts.push(...surfaceAlerts(mergeClients));

    logger.info('merge_result', {
      mergedCount,
      unmergedCount,
      skippedCount,
      alerts: this.alerts,
      referenceSelection: this.referenceSelection,
      accurate: merged.isAccurate(),
    });

    return {
      events: merged,
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

    return classifyClients(this.clients);
  }
}

type MergeStepOutcome =
  | { kind: 'merged' }
  | { kind: 'unmerged' }
  | { kind: 'skipped' }
  | { kind: 'rejected'; rejection: StepRejection };

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

export class MergedEvents {
  private ticks: TickStateArray;
  private readonly status: StageStatus;
  private readonly ctx: MergeContext;
  private readonly preciseServerTickCount: boolean;
  private accurate: boolean;
  private finalized: boolean;

  constructor(base: ClientEvents, ctx: MergeContext) {
    const serverTicks = base.getServerTicks();
    const tickCount =
      serverTicks !== null ? serverTicks.count : base.getFinalTick();

    this.status = base.getStatus();
    this.ctx = ctx;
    this.preciseServerTickCount = serverTicks?.precise === true;
    this.accurate = base.isAccurate();
    this.finalized = false;
    this.ticks = Array<TickState | null>(tickCount + 1).fill(null);
    this.initializeBaseTicks(base);
  }

  public events(): EventIterator {
    if (!this.finalized) {
      throw new Error('Merge not finalized');
    }
    return new EventIterator(this.ticks);
  }

  [Symbol.iterator](): EventIterator {
    return this.events();
  }

  public isAccurate(): boolean {
    return this.accurate;
  }

  public hasPreciseServerTickCount(): boolean {
    return this.preciseServerTickCount;
  }

  public getTicks(): TickStateArray {
    return [...this.ticks];
  }

  public getStatus(): StageStatus {
    return this.status;
  }

  public getLastTick(): number {
    return this.ticks.length - 1;
  }

  public getMissingTickCount(): number {
    return this.ticks.filter((tick) => tick === null).length;
  }

  public eventsForTick(tick: number): Event[] {
    return this.ticks[tick]?.getEvents() ?? [];
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
    let baseMapping: TickMapping;
    let targetMapping: TickMapping;
    let mergedTickCount: number;

    if (this.accurate && client.isAccurate()) {
      // Accurate clients use identity mapping.
      baseMapping = TickMapping.identity(this.ticks.length);
      targetMapping = TickMapping.identity(targetTicks.length);
      mergedTickCount = this.ticks.length;
    } else {
      if (!options.alignMismatched) {
        return { kind: 'unmerged' };
      }
      const alignment = this.runAlignment(client);
      if (alignment === null) {
        return { kind: 'unmerged' };
      }
      const result = TickMapping.fromAlignment(
        this.ticks.length,
        targetTicks.length,
        alignment,
      );
      baseMapping = result.base;
      targetMapping = result.target;
      mergedTickCount = result.mergedTickCount;
    }

    this.ctx.mapping.begin(
      client.getId(),
      baseMapping,
      targetMapping,
      mergedTickCount,
    );
    this.ctx.tracer?.recordMapping(this.ctx.mapping);

    try {
      const consolidator = new EventConsolidator(
        this.ticks,
        targetTicks,
        this.ctx,
      );
      const result = consolidator.consolidate();

      const consistencyChecker = new MergeConsistencyChecker(this.ctx);
      const issues = consistencyChecker.check(result.ticks);
      if (issues.length > 0) {
        this.ctx.mapping.discard();
        return {
          kind: 'rejected',
          rejection: {
            reason: RejectionReason.POST_MERGE_CONSISTENCY,
            issues,
          },
        };
      }

      this.ctx.mapping.commit();

      this.ticks = result.ticks;
      return { kind: 'merged' };
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
    resynchronizeTicks(this.ctx.stage, this.ticks);

    const derivedEvents = derivedEventGeneratorForStage(
      this.ctx.stage,
      this.ctx.challenge.mode,
    );
    derivedEvents?.derive(this.ticks);

    mergeStageData(this.ctx, this.ticks);

    this.finalized = true;
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

    // TODO(frolv): Replace with a proper merge confidence score that also
    // considers per-tick similarity scores and gap count.
    if (alignment.coverage < MIN_ALIGNMENT_COVERAGE) {
      logger.info('merge_alignment_rejected', {
        clientId: client.getId(),
        coverage: alignment.coverage,
        threshold: MIN_ALIGNMENT_COVERAGE,
      });
      return null;
    }

    return alignment;
  }

  private initializeBaseTicks(base: ClientEvents): void {
    if (base.isAccurate()) {
      logger.debug('merge_base_ticks', { accurate: true });
      for (let i = 0; i <= base.getFinalTick(); i++) {
        this.ticks[i] = base.getTickState(i)?.clone() ?? null;
      }
      return;
    }

    if (base.getServerTicks() !== null) {
      // If the base client is not accurate but has reported an in-game tick
      // count, it has completed the stage, so it is initially assumed that its
      // events are offset from the end of the stage.
      const offset = base.getServerTicks()!.count - base.getFinalTick();
      logger.debug('merge_base_ticks', {
        accurate: false,
        offset,
      });

      const remap = (tick: number): number => tick + offset;
      for (let i = 0; i <= base.getFinalTick(); i++) {
        const state = base.getTickState(i);
        if (state !== null) {
          const newTick = remap(i);
          const events = state
            .getTaggedEvents()
            .map((t) => remapEventTick(t, remap));
          this.ticks[newTick] = new TickState(
            newTick,
            events,
            new Map(state.getPlayerStates()),
            new Map(state.getNpcs()),
            new Map(state.getGraphics()),
          );
        }
      }
    } else {
      logger.debug('merge_base_ticks', { accurate: false, offset: 0 });
      for (let i = 0; i <= base.getFinalTick(); i++) {
        this.ticks[i] = base.getTickState(i)?.clone() ?? null;
      }
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
