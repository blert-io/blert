import { NpcAttack, PlayerAttack } from '@blert/common';
import { Event } from '@blert/common/generated/event_pb';

import { MergeContext } from './context';
import {
  ATTACK_MAPPED_EVENT_TYPES,
  AttackMappedEventType,
  BUFFERED_EVENT_TYPES,
  EventType,
  STREAM_EVENT_CONFIGS,
  StreamEventConfig,
  StreamEventType,
  TaggedEvent,
} from './event';
import logger from '../log';
import { TickMapping } from './tick-mapping';
import { TickState, TickStateArray } from './tick-state';
import { AttackMappedCandidate, TickMergeDecisionType } from './trace';

export type BufferedEvent = {
  tagged: TaggedEvent;
  mergedTick: number;
  clientTick: number;
};

export type EventBuffer = Map<EventType, BufferedEvent[]>;

export type ConsolidatorConfig = {
  /** Tick gap above which a paired stream event is flagged as suspicious. */
  largeGapThreshold: number;
};

const DEFAULT_CONFIG: ConsolidatorConfig = {
  largeGapThreshold: 10,
};

export type ConsolidationResult = {
  /** The merged timeline. */
  ticks: TickStateArray;
  /** Temporal gaps and other quality signals from stream reconciliation. */
  qualityFlags: QualityFlag[];
};

export type QualityFlag =
  | {
      kind: 'LARGE_TEMPORAL_GAP';
      eventType: EventType;
      tickGap: number;
      baseTick: number;
      targetTick: number;
    }
  | {
      kind: 'UNEXPECTED_CONFLICT';
      eventType: EventType;
      attackTick: number;
      candidateCount: number;
    };

type AttackMappedEventConfig = {
  /** Extracts the referenced attack tick from the event's sub-message. */
  getReferencedTick: (event: Event) => number | undefined;
  /** Checks whether the referenced attack exists at the given tick state. */
  validateAttack: (state: TickState, event: Event) => boolean;
  /** Whether conflicts between clients are expected for this event type. */
  conflictExpected: boolean;
  /** Checks whether two candidates agree on the event content. */
  candidatesAgree: (a: Event, b: Event) => boolean;
};

function hasNpcAttack(state: TickState, attack: NpcAttack): boolean {
  return state
    .getEventsByType(Event.Type.NPC_ATTACK)
    .some((e) => e.getNpcAttack()!.getAttack() === attack);
}

const ATTACK_MAPPED_CONFIGS: Record<
  AttackMappedEventType,
  AttackMappedEventConfig
> = {
  [Event.Type.TOB_VERZIK_ATTACK_STYLE]: {
    getReferencedTick: (e) => e.getVerzikAttackStyle()?.getNpcAttackTick(),
    validateAttack: (state) =>
      hasNpcAttack(state, NpcAttack.TOB_VERZIK_P3_AUTO),
    conflictExpected: true,
    candidatesAgree: (a, b) =>
      a.getVerzikAttackStyle()?.getStyle() ===
      b.getVerzikAttackStyle()?.getStyle(),
  },
  [Event.Type.TOB_VERZIK_BOUNCE]: {
    getReferencedTick: (e) => e.getVerzikBounce()?.getNpcAttackTick(),
    validateAttack: (state) =>
      hasNpcAttack(state, NpcAttack.TOB_VERZIK_P2_BOUNCE),
    conflictExpected: false,
    candidatesAgree: (a, b) =>
      a.getVerzikBounce()?.getBouncedPlayer() ===
      b.getVerzikBounce()?.getBouncedPlayer(),
  },
  [Event.Type.TOB_VERZIK_DAWN]: {
    getReferencedTick: (e) => e.getVerzikDawn()?.getAttackTick(),
    validateAttack: (state, event) =>
      state
        .getEventsByType(Event.Type.PLAYER_ATTACK)
        .some(
          (e) =>
            e.getPlayer()!.getName() ===
              (event.getVerzikDawn()?.getPlayer() ?? '') &&
            e.getPlayerAttack()!.getType() === PlayerAttack.DAWN_SPEC,
        ),
    conflictExpected: false,
    candidatesAgree: (a, b) =>
      a.getVerzikDawn()?.getPlayer() === b.getVerzikDawn()?.getPlayer() &&
      a.getVerzikDawn()?.getDamage() === b.getVerzikDawn()?.getDamage(),
  },
};

/**
 * Consolidates events from two client timelines into a single merged timeline.
 *
 * The consolidator takes two timelines and an optional alignment result, and
 * produces a tentative merged output timeline with the events of both clients.
 *
 * `alignment` describes how ticks map to each other between the two clients.
 * A `null` value uses an identity mapping.
 */
export class EventConsolidator {
  private readonly baseTicks: TickStateArray;
  private readonly targetTicks: TickStateArray;
  private readonly ctx: MergeContext;
  private readonly config: ConsolidatorConfig;

  private mergedTicks: TickStateArray = [];
  private baseBuffer: EventBuffer = new Map();
  private targetBuffer: EventBuffer = new Map();
  private qualityFlags: QualityFlag[] = [];

  public constructor(
    baseTicks: TickStateArray,
    targetTicks: TickStateArray,
    ctx: MergeContext,
    config: Partial<ConsolidatorConfig> = {},
  ) {
    this.baseTicks = baseTicks;
    this.targetTicks = targetTicks;
    this.ctx = ctx;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  private get baseMapping(): TickMapping {
    return this.ctx.mapping.getBaseMapping()!;
  }

  private get targetMapping(): TickMapping {
    return this.ctx.mapping.getTargetMapping()!;
  }

  /**
   * Runs consolidation and returns the merged timeline.
   */
  public consolidate(): ConsolidationResult {
    this.qualityFlags = [];

    // Build the merged tick array using the mappings from the merge context.
    this.buildTimeline();

    // Pass 1: walk the merged timeline and unify per-tick state.
    this.consolidateTicks();

    // Pass 2: reconcile stream events from both buffers.
    this.reconcileStreams();

    // Renumber ticks to their correct merged positions, correcting cross-tick
    // references within the tick states' events.
    this.renumberTicks();

    this.ctx.tracer?.recordQualityFlags(this.qualityFlags);

    return {
      ticks: this.mergedTicks,
      qualityFlags: this.qualityFlags,
    };
  }

  /**
   * Builds the merged tick array by placing base and target ticks at their
   * mapped positions. Stream events are extracted into per-side buffers.
   */
  private buildTimeline(): void {
    const mergedTickCount = this.ctx.mapping.getMergedTickCount()!;
    this.mergedTicks = Array<TickState | null>(mergedTickCount).fill(null);

    // Place base ticks at their mapped positions, extracting stream events.
    for (let baseIdx = 0; baseIdx < this.baseTicks.length; baseIdx++) {
      const mergedIdx = this.baseMapping.toMerged(baseIdx);
      if (mergedIdx === undefined || this.baseTicks[baseIdx] === null) {
        continue;
      }
      const cloned = this.baseTicks[baseIdx]!.clone();
      this.bufferEvents(
        this.baseBuffer,
        cloned.extractEvents(BUFFERED_EVENT_TYPES),
        mergedIdx,
        baseIdx,
      );
      this.mergedTicks[mergedIdx] = cloned;
    }

    // Insert target ticks where the base has no data, extracting stream events.
    for (let targetIdx = 0; targetIdx < this.targetTicks.length; targetIdx++) {
      const mergedIdx = this.targetMapping.toMerged(targetIdx);
      if (mergedIdx === undefined || this.mergedTicks[mergedIdx] !== null) {
        continue;
      }
      const targetState = this.targetTicks[targetIdx];
      if (targetState === null) {
        continue;
      }
      const cloned = targetState.clone();
      this.bufferEvents(
        this.targetBuffer,
        cloned.extractEvents(BUFFERED_EVENT_TYPES),
        mergedIdx,
        targetIdx,
      );
      this.mergedTicks[mergedIdx] = cloned;
    }
  }

  /**
   * Walks the merged timeline, buffering stream events from the target and
   * merging tick-state data at positions where both base and target exist.
   * FILLED and INSERT positions were fully handled during the build step.
   */
  private consolidateTicks(): void {
    for (let m = 0; m < this.mergedTicks.length; m++) {
      const baseIdx = this.baseMapping.toClient(m);
      const targetIdx = this.targetMapping.toClient(m);

      const hasBase = baseIdx !== undefined && this.baseTicks[baseIdx] !== null;
      const hasTarget =
        targetIdx !== undefined && this.targetTicks[targetIdx] !== null;

      if (hasBase && hasTarget) {
        const targetClone = this.targetTicks[targetIdx]!.clone();
        this.bufferEvents(
          this.targetBuffer,
          targetClone.extractEvents(BUFFERED_EVENT_TYPES),
          m,
          targetIdx,
        );

        const mergedState = this.mergedTicks[m]!;
        if (mergedState.merge(targetClone)) {
          this.ctx.tracer?.recordTickDecision({
            tick: m,
            type: TickMergeDecisionType.MERGED,
          });
        } else {
          logger.warn('consolidate_tick_conflict', {
            mergedTick: m,
            baseTick: baseIdx,
            targetTick: targetIdx,
          });
          this.ctx.tracer?.recordTickDecision({
            tick: m,
            type: TickMergeDecisionType.SKIPPED,
          });
        }
        continue;
      }

      const decision = hasBase
        ? TickMergeDecisionType.RETAINED
        : hasTarget
          ? TickMergeDecisionType.FILLED
          : TickMergeDecisionType.SKIPPED;
      this.ctx.tracer?.recordTickDecision({
        tick: m,
        type: decision,
      });
    }
  }

  /**
   * Adds events to an event buffer, grouped by type.
   */
  private bufferEvents(
    buffer: EventBuffer,
    events: TaggedEvent[],
    mergedTick: number,
    clientTick: number,
  ): void {
    for (const tagged of events) {
      const type = tagged.event.getType() as EventType;
      let list = buffer.get(type);
      if (list === undefined) {
        list = [];
        buffer.set(type, list);
      }
      list.push({ tagged, mergedTick, clientTick });
    }
  }

  private reconcileStreams(): void {
    for (const [type, config] of Object.entries(STREAM_EVENT_CONFIGS)) {
      const eventType = Number(type) as StreamEventType;
      const baseEvents = this.baseBuffer.get(eventType) ?? [];
      const targetEvents = this.targetBuffer.get(eventType) ?? [];
      if (baseEvents.length > 0 || targetEvents.length > 0) {
        this.deduplicateStreamEvents(
          eventType,
          baseEvents,
          targetEvents,
          config,
        );
      }
    }

    for (const type of ATTACK_MAPPED_EVENT_TYPES) {
      const baseEvents = this.baseBuffer.get(type) ?? [];
      const targetEvents = this.targetBuffer.get(type) ?? [];
      if (baseEvents.length > 0 || targetEvents.length > 0) {
        this.resolveAttackMappedEvents(type, baseEvents, targetEvents);
      }
    }
  }

  /**
   * Deduplicates stream events of a single type between base and target
   * buffers using the event's identity key and temporal window.
   */
  private deduplicateStreamEvents(
    type: StreamEventType,
    baseEvents: BufferedEvent[],
    targetEvents: BufferedEvent[],
    config: StreamEventConfig,
  ): void {
    const baseByKey = new Map<string, BufferedEvent[]>();
    for (const e of baseEvents) {
      const key = config.identityKey(e.tagged.event);
      let list = baseByKey.get(key);
      if (list === undefined) {
        list = [];
        baseByKey.set(key, list);
      }
      list.push(e);
    }

    const targetByKey = new Map<string, BufferedEvent[]>();
    for (const e of targetEvents) {
      const key = config.identityKey(e.tagged.event);
      let list = targetByKey.get(key);
      if (list === undefined) {
        list = [];
        targetByKey.set(key, list);
      }
      list.push(e);
    }

    const allKeys = new Set([...baseByKey.keys(), ...targetByKey.keys()]);

    for (const key of allKeys) {
      const base = (baseByKey.get(key) ?? []).toSorted(
        (a, b) => a.mergedTick - b.mergedTick,
      );
      const target = (targetByKey.get(key) ?? []).toSorted(
        (a, b) => a.mergedTick - b.mergedTick,
      );

      if (config.temporalWindow === null) {
        this.matchUnique(type, key, base, target);
      } else {
        this.matchTemporal(type, key, base, target, config.temporalWindow);
      }
    }
  }

  /**
   * Matches stream events that are unique per identity key.
   * Each side should have at most one occurrence; if both have one, the
   * earliest tick wins.
   */
  private matchUnique(
    type: StreamEventType,
    key: string,
    base: BufferedEvent[],
    target: BufferedEvent[],
  ): void {
    if (base.length > 1 || target.length > 1) {
      logger.warn('consolidate_duplicate_unique_event', {
        eventType: type,
        identityKey: key,
        baseCount: base.length,
        targetCount: target.length,
      });
    }

    const b = base[0] ?? null;
    const t = target[0] ?? null;

    if (b !== null && t !== null) {
      const winner = b.mergedTick <= t.mergedTick ? b : t;
      this.insertBufferedEvent(winner);
      this.ctx.tracer?.recordStreamResolution(
        type,
        key,
        { mergedTick: b.mergedTick, clientTick: b.clientTick },
        { mergedTick: t.mergedTick, clientTick: t.clientTick },
        winner.mergedTick,
        'PAIRED',
        null,
      );
      // Unique events match by identity regardless of timing, so large gaps
      // are expected (e.g. a client joining late sees NPC spawns later). Don't
      // flag them.
    } else if (b !== null) {
      this.insertBufferedEvent(b);
      this.ctx.tracer?.recordStreamResolution(
        type,
        key,
        { mergedTick: b.mergedTick, clientTick: b.clientTick },
        null,
        b.mergedTick,
        'UNPAIRED_BASE',
        null,
      );
    } else if (t !== null) {
      this.insertBufferedEvent(t);
      this.ctx.tracer?.recordStreamResolution(
        type,
        key,
        null,
        { mergedTick: t.mergedTick, clientTick: t.clientTick },
        t.mergedTick,
        'UNPAIRED_TARGET',
        null,
      );
    }
  }

  /**
   * Matches events using a two-pointer walk over base and target occurrences
   * sorted by merged tick. Events within the temporal window are paired
   * (earliest tick wins). Events outside the window are emitted as unpaired.
   */
  private matchTemporal(
    type: StreamEventType,
    key: string,
    base: BufferedEvent[],
    target: BufferedEvent[],
    window: number,
  ): void {
    let bi = 0;
    let ti = 0;

    while (bi < base.length || ti < target.length) {
      const b = base[bi] ?? null;
      const t = target[ti] ?? null;

      if (b !== null && t !== null) {
        const gap = Math.abs(b.mergedTick - t.mergedTick);
        if (gap <= window) {
          // Earliest tick wins: a client can delay seeing an event, but it
          // can't see an event before it actually occurs.
          const winner = b.mergedTick <= t.mergedTick ? b : t;
          this.insertBufferedEvent(winner);

          if (gap > this.config.largeGapThreshold) {
            this.qualityFlags.push({
              kind: 'LARGE_TEMPORAL_GAP',
              eventType: type,
              tickGap: gap,
              baseTick: b.mergedTick,
              targetTick: t.mergedTick,
            });
          }

          this.ctx.tracer?.recordStreamResolution(
            type,
            key,
            { mergedTick: b.mergedTick, clientTick: b.clientTick },
            { mergedTick: t.mergedTick, clientTick: t.clientTick },
            winner.mergedTick,
            'PAIRED',
            gap > this.config.largeGapThreshold
              ? `large gap: ${gap} ticks`
              : null,
          );
          bi++;
          ti++;
        } else if (b.mergedTick < t.mergedTick) {
          // This occurrence is unique to the base.
          this.insertBufferedEvent(b);
          this.ctx.tracer?.recordStreamResolution(
            type,
            key,
            { mergedTick: b.mergedTick, clientTick: b.clientTick },
            null,
            b.mergedTick,
            'UNPAIRED_BASE',
            null,
          );
          bi++;
        } else {
          // This occurrence is unique to the target.
          this.insertBufferedEvent(t);
          this.ctx.tracer?.recordStreamResolution(
            type,
            key,
            null,
            { mergedTick: t.mergedTick, clientTick: t.clientTick },
            t.mergedTick,
            'UNPAIRED_TARGET',
            null,
          );
          ti++;
        }
        continue;
      }

      if (b !== null) {
        this.insertBufferedEvent(b);
        this.ctx.tracer?.recordStreamResolution(
          type,
          key,
          { mergedTick: b.mergedTick, clientTick: b.clientTick },
          null,
          b.mergedTick,
          'UNPAIRED_BASE',
          null,
        );
        bi++;
      } else if (t !== null) {
        this.insertBufferedEvent(t);
        this.ctx.tracer?.recordStreamResolution(
          type,
          key,
          null,
          { mergedTick: t.mergedTick, clientTick: t.clientTick },
          t.mergedTick,
          'UNPAIRED_TARGET',
          null,
        );
        ti++;
      }
    }
  }

  /**
   * Resolves events that reference a previous NPC attack by mapping them
   * back to the merged timeline.
   */
  private resolveAttackMappedEvents(
    type: AttackMappedEventType,
    baseEvents: BufferedEvent[],
    targetEvents: BufferedEvent[],
  ): void {
    const config = ATTACK_MAPPED_CONFIGS[type];

    type Candidate = AttackMappedCandidate & { tagged: TaggedEvent };

    const groups = new Map<number, Candidate[]>();

    const tryResolve = (
      buffered: BufferedEvent,
      mapping: TickMapping,
      source: 'base' | 'target',
    ) => {
      const referencedTick = config.getReferencedTick(buffered.tagged.event);
      if (referencedTick === undefined) {
        this.ctx.tracer?.recordAttackMappedDiscard(
          type,
          source,
          buffered.clientTick,
          null,
          'NO_REFERENCE',
        );
        return;
      }

      const mergedTick = mapping.toMerged(referencedTick);
      if (mergedTick === undefined) {
        this.ctx.tracer?.recordAttackMappedDiscard(
          type,
          source,
          buffered.clientTick,
          referencedTick,
          'UNMAPPED_TICK',
        );
        return;
      }

      const state = this.mergedTicks[mergedTick];
      if (
        state === null ||
        !config.validateAttack(state, buffered.tagged.event)
      ) {
        this.ctx.tracer?.recordAttackMappedDiscard(
          type,
          source,
          buffered.clientTick,
          referencedTick,
          'ATTACK_NOT_FOUND',
        );
        return;
      }

      let group = groups.get(mergedTick);
      if (group === undefined) {
        group = [];
        groups.set(mergedTick, group);
      }
      group.push({
        tagged: buffered.tagged,
        source,
        sourceClientId: buffered.tagged.source,
        clientTick: buffered.clientTick,
        referencedTick,
      });
    };

    for (const buffered of baseEvents) {
      tryResolve(buffered, this.baseMapping, 'base');
    }
    for (const buffered of targetEvents) {
      tryResolve(buffered, this.targetMapping, 'target');
    }

    for (const [attackTick, candidates] of groups) {
      const insertTick = attackTick + 1;

      const insert = (candidate: Candidate) => {
        this.insertTaggedEvent(insertTick, {
          event: candidate.tagged.event.clone(),
          source: candidate.tagged.source,
        });
      };

      if (candidates.length === 1) {
        insert(candidates[0]);
        this.ctx.tracer?.recordAttackMappedResolution(
          type,
          attackTick,
          candidates,
          insertTick,
          'RESOLVED',
          null,
        );
      } else {
        // Check if all candidates agree on the event content.
        const allAgree = candidates
          .slice(1)
          .every((c) =>
            config.candidatesAgree(candidates[0].tagged.event, c.tagged.event),
          );

        const base = candidates.find((c) => c.source === 'base');
        const winner = base ?? candidates[0];
        insert(winner);

        if (allAgree) {
          this.ctx.tracer?.recordAttackMappedResolution(
            type,
            attackTick,
            candidates,
            insertTick,
            'RESOLVED',
            null,
          );
        } else if (config.conflictExpected) {
          // TODO(frolv): Proximity-based resolution (for attack style)
          // requires per-event provenance. Default to base for now.
          this.ctx.tracer?.recordAttackMappedResolution(
            type,
            attackTick,
            candidates,
            insertTick,
            'CONFLICT_RESOLVED',
            `preferred ${winner.source}`,
          );
        } else {
          logger.warn('consolidate_unexpected_attack_mapped_conflict', {
            eventType: type,
            attackTick,
            candidateCount: candidates.length,
          });
          this.qualityFlags.push({
            kind: 'UNEXPECTED_CONFLICT',
            eventType: type,
            attackTick,
            candidateCount: candidates.length,
          });
          this.ctx.tracer?.recordAttackMappedResolution(
            type,
            attackTick,
            candidates,
            insertTick,
            'CONFLICT_UNEXPECTED',
            `preferred ${winner.source}`,
          );
        }
      }
    }
  }

  private insertBufferedEvent(buffered: BufferedEvent): void {
    this.insertTaggedEvent(buffered.mergedTick, buffered.tagged);
  }

  private insertTaggedEvent(mergedTick: number, tagged: TaggedEvent): void {
    if (mergedTick >= 0 && mergedTick < this.mergedTicks.length) {
      this.mergedTicks[mergedTick]?.addTaggedEvents([tagged]);
    }
  }

  /**
   * Renumbers all ticks in the merged timeline sequentially, preserving the
   * start tick offset from the base timeline.
   */
  private renumberTicks(): void {
    let startTick = 0;
    for (let i = 0; i < this.baseTicks.length; i++) {
      if (this.baseTicks[i] !== null) {
        startTick = this.baseTicks[i]!.getTick() - i;
        break;
      }
    }

    for (let i = 0; i < this.mergedTicks.length; i++) {
      // TODO(frolv): properly handle cross-tick references
      this.mergedTicks[i]?.setTick(startTick + i);
    }
  }
}
