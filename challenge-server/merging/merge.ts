import {
  ChallengeType,
  Npc,
  SkillLevel,
  Stage,
  StageStatus,
} from '@blert/common';
import { Event } from '@blert/common/generated/event_pb';

import { TickAligner } from './alignment';
import {
  ClassifiedClients,
  classifyClients,
  ReferenceSelection,
} from './classification';
import {
  ClientAnomaly,
  ClientEvents,
  ConsistencyIssue,
  ServerTicks,
} from './client-events';
import logger from '../log';
import { SimilarityScorer } from './similarity-scorer';
import { TickState } from './tick-state';

export type ChallengeInfo = {
  uuid: string;
  type: ChallengeType;
  party: string[];
};

export const enum MergeAlertType {
  MULTIPLE_ACCURATE_TICK_MODES = 'MULTIPLE_ACCURATE_TICK_MODES',
}

export type MergeAlert = {
  type: MergeAlertType;
  details?: Record<string, unknown>;
};

export const enum MergeClientStatus {
  /** The client was successfully merged into the merged events. */
  MERGED = 'MERGED',

  /** The client could not be merged into the merged events. */
  UNMERGED = 'UNMERGED',

  /** The client was skipped due to critical anomalies or other issues. */
  SKIPPED = 'SKIPPED',
}

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
  status: MergeClientStatus;
  classification: MergeClientClassification;
  sequenceNumber: number;
  recordedTicks: number;
  serverTicks: ServerTicks | null;
  reportedAccurate: boolean;
  derivedAccurate: boolean;
  anomalies: ClientAnomaly[];
  consistencyIssues: ConsistencyIssue[];
  spectator: boolean;
  // TODO(frolv): Add alignment information if available.
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

export class Merger {
  private readonly stage: Stage;
  private readonly clients: ClientEvents[];
  private readonly alerts: MergeAlert[];
  private referenceSelection: ReferenceSelection | null;

  public constructor(stage: Stage, clients: ClientEvents[]) {
    this.stage = stage;
    this.clients = clients.toSorted(
      (a, b) => b.getFinalTick() - a.getFinalTick(),
    );
    this.alerts = [];
    this.referenceSelection = null;
  }

  public merge(): MergeResult | null {
    if (this.clients.length === 0) {
      logger.warn('merge_no_clients', { stage: this.stage });
      return null;
    }

    logger.debug('merge_start', {
      stage: this.stage,
      clientMetadata: this.clients.map((c) => ({
        id: c.getId(),
        tickCount: c.getFinalTick(),
        accurate: c.isAccurate(),
      })),
    });

    const mergeClients: MergeClient[] = [];

    const clients = this.classifyAndUpdateClients();
    this.referenceSelection = clients.referenceTicks;

    mergeClients.push(
      this.createMergeClient(
        clients.base,
        MergeClientClassification.REFERENCE,
        MergeClientStatus.MERGED,
        0,
      ),
    );

    const merged = new MergedEvents(clients.base);

    const mergeFrom = (
      client: ClientEvents,
      classification: MergeClientClassification,
    ) => {
      const status = merged.mergeEventsFrom(client)
        ? MergeClientStatus.MERGED
        : MergeClientStatus.UNMERGED;
      mergeClients.push(
        this.createMergeClient(
          client,
          classification,
          status,
          mergeClients.length,
        ),
      );
    };

    for (const client of clients.matching) {
      mergeFrom(client, MergeClientClassification.MATCHING);
    }

    for (const client of clients.mismatched) {
      mergeFrom(client, MergeClientClassification.MISMATCHED);
    }

    const { mergedCount, unmergedCount, skippedCount } =
      this.getMergeCounts(mergeClients);

    merged.postprocess(this.stage);

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

  private createMergeClient(
    client: ClientEvents,
    classification: MergeClientClassification,
    status: MergeClientStatus,
    sequenceNumber: number,
  ): MergeClient {
    return {
      id: client.getId(),
      status,
      classification,
      sequenceNumber,
      recordedTicks: client.getFinalTick(),
      serverTicks: client.getServerTicks(),
      reportedAccurate: client.getReportedAccurate(),
      derivedAccurate: client.isAccurate(),
      anomalies: client.getAnomalies(),
      consistencyIssues: client.getConsistencyIssues(),
      spectator: client.isSpectator(),
    };
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

  private classifyAndUpdateClients(): ClassifiedClients {
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
          }
        }
      }
    }

    return classifyClients(this.clients);
  }
}

export class MergedEvents {
  private ticks: (TickState | null)[];
  private readonly status: StageStatus;
  private accurate: boolean;

  constructor(base: ClientEvents) {
    const tickCount =
      base.getServerTicks() !== null
        ? base.getServerTicks()!.count
        : base.getFinalTick();

    this.status = base.getStatus();
    this.accurate = base.isAccurate();
    this.ticks = Array<TickState | null>(tickCount + 1).fill(null);
    this.initializeBaseTicks(base);
  }

  public events(): EventIterator {
    return new EventIterator(this.ticks);
  }

  [Symbol.iterator](): EventIterator {
    return this.events();
  }

  public isAccurate(): boolean {
    return this.accurate;
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
   * @param client Client to merge events from.
   * @returns Whether the merge was successful.
   */
  public mergeEventsFrom(client: ClientEvents): boolean {
    let success = false;

    if (this.accurate) {
      if (client.isAccurate()) {
        success = this.mergeAccurateEvents(client);
      } else {
        logger.warn('merge_unimplemented', {
          accurate: this.accurate,
          client: { id: client.getId(), accurate: client.isAccurate() },
        });
      }
    } else {
      logger.warn('merge_unimplemented', {
        accurate: this.accurate,
        client: { id: client.getId(), accurate: client.isAccurate() },
      });

      const now = Date.now();
      const scorer = new SimilarityScorer();
      const aligner = new TickAligner(
        this.ticks,
        client.getTickStates(),
        (a, b) => scorer.score(a, b),
      );
      const alignment = aligner.align();
      console.dir(alignment, { depth: null });
      console.log('alignment time:', Date.now() - now, 'ms');
    }

    if (success) {
      this.ticks.forEach((tick) => tick?.resynchronize(this.ticks));
    }

    return success;
  }

  /**
   * Applies post-merge corrections to the event set.
   * @param stage Stage that the events are being merged for.
   */
  public postprocess(stage: Stage): void {
    if (stage === Stage.TOB_MAIDEN) {
      this.correctOffsetMaidenSpawn();
    }
  }

  private initializeBaseTicks(base: ClientEvents): void {
    if (base.isAccurate()) {
      logger.debug('merge_base_ticks', { accurate: true });
      for (let i = 0; i <= base.getFinalTick(); i++) {
        this.ticks[i] = base.getTickState(i)?.clone() ?? null;
      }
    } else if (base.getServerTicks() !== null) {
      // If the base client is not accurate but has reported an in-game tick
      // count, it has completed the stage, so it is initially assumed that its
      // events are offset from the end of the stage.
      const offset = base.getServerTicks()!.count - base.getFinalTick();
      logger.debug('merge_base_ticks', {
        accurate: false,
        offset,
      });
      for (let i = 0; i <= base.getFinalTick(); i++) {
        const state = base.getTickState(i);
        if (state !== null) {
          const tickState = state.clone();
          tickState.setTick(i + offset);
          this.ticks[i + offset] = tickState;
        }
      }
    } else {
      logger.debug('merge_base_ticks', { accurate: false, offset: 0 });
      for (let i = 0; i <= base.getFinalTick(); i++) {
        this.ticks[i] = base.getTickState(i)?.clone() ?? null;
      }
    }
  }

  private mergeAccurateEvents(client: ClientEvents): boolean {
    for (let tick = this.ticks.length - 1; tick >= 0; tick--) {
      const stateToMerge = client.getTickState(tick);
      if (stateToMerge === null) {
        continue;
      }

      const existingState = this.ticks[tick];
      if (existingState !== null) {
        if (!existingState.merge(stateToMerge)) {
          logger.error('merge_tick_conflict', {
            tick,
            clientId: client.getId(),
          });
          return false;
        }
      } else {
        this.ticks[tick] = stateToMerge.clone();
      }
    }

    return true;
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
    let firstMaidenEvent = null;
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

    const events = tickState.getEvents();
    const maidenSpawn = events.find(
      (e) => e.getType() === Event.Type.NPC_SPAWN,
    );
    if (maidenSpawn === undefined) {
      return;
    }

    // On the affected tick, change the NPC spawn event to an NPC update.
    const updateEvent = maidenSpawn.clone();
    updateEvent.setType(Event.Type.NPC_UPDATE);

    const otherEvents = events.filter((e) => e !== maidenSpawn);
    this.ticks[tick] = new TickState(
      tick,
      [...otherEvents, updateEvent],
      tickState.getPlayerStates(),
    );

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

      this.ticks[i] = new TickState(
        i,
        [...state.getEvents(), newEvent],
        state.getPlayerStates(),
      );
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
