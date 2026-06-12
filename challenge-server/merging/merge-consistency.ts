import { PlayerAttack, Stage, attackDefinitionsById } from '@blert/common';
import { Event } from '@blert/common/generated/event_pb';

import { MergeContext } from './context';
import {
  EventType,
  isStreamEventType,
  STREAM_EVENT_CONFIGS,
  StreamEventType,
} from './event';
import { TickStateArray } from './tick-state';

/** Defines an ordering invariant over a set of stream event types. */
type OrderingRule = {
  eventTypes: ReadonlySet<EventType>;
  extractOrdinal: (event: Event, type: EventType) => number;
};

/** Registry of event pairs that are mutually exclusive on a single tick. */
const EXCLUSIVE_EVENT_PAIRS: ReadonlyMap<
  Stage,
  readonly (readonly [EventType, EventType])[]
> = new Map([
  [
    Stage.TOB_BLOAT,
    [[Event.Type.TOB_BLOAT_DOWN, Event.Type.TOB_BLOAT_UP]] as const,
  ],
]);

/** Rules for validating the order of sequential events within a stage. */
const ORDERING_RULES: ReadonlyMap<Stage, readonly OrderingRule[]> = new Map([
  [
    Stage.TOB_XARPUS,
    [
      {
        eventTypes: new Set([Event.Type.TOB_XARPUS_PHASE]),
        extractOrdinal: (e) => e.getXarpusPhase(),
      },
    ],
  ],
  [
    Stage.TOB_VERZIK,
    [
      {
        eventTypes: new Set([Event.Type.TOB_VERZIK_PHASE]),
        extractOrdinal: (e) => e.getVerzikPhase(),
      },
    ],
  ],
  [
    Stage.TOB_NYLOCAS,
    [
      {
        eventTypes: new Set([Event.Type.TOB_NYLO_WAVE_SPAWN]),
        extractOrdinal: (e) => e.getNyloWave()!.getWave(),
      },
    ],
  ],
  [
    Stage.TOB_SOTETSEG,
    [
      {
        eventTypes: new Set([
          Event.Type.TOB_SOTE_MAZE_PROC,
          Event.Type.TOB_SOTE_MAZE_END,
        ]),
        // Insert MAZE_END events after their corresponding MAZE_PROC events
        // in a linear sequence.
        extractOrdinal: (e, t) =>
          e.getSoteMaze()!.getMaze() * 2 +
          (t === Event.Type.TOB_SOTE_MAZE_END ? 1 : 0),
      },
    ],
  ],
]);

/**
 * Issues detected by the post-merge consistency checker.
 * Each issue is a violation of a game invariant that the plugin enforces on a
 * single client, meaning that it must have been introduced by the merger.
 */
export type MergeConsistencyIssue =
  | DuplicatePlayerDeathIssue
  | DuplicateNpcEventIssue
  | DuplicateStreamEventIssue
  | WeaponCooldownViolationIssue
  | DeathBeforeSpawnIssue
  | PhaseOutOfOrderIssue
  | AttackTargetMissingIssue
  | ExclusiveEventViolationIssue;

export type DuplicatePlayerDeathIssue = {
  kind: 'DUPLICATE_PLAYER_DEATH';
  player: string;
  ticks: number[];
};

export type DuplicateNpcEventIssue = {
  kind: 'DUPLICATE_NPC_SPAWN' | 'DUPLICATE_NPC_DEATH';
  roomId: number;
  occurrences: { tick: number; npcId: number }[];
};

export type DuplicateStreamEventIssue = {
  kind: 'DUPLICATE_STREAM_EVENT';
  eventType: EventType;
  identityKey: string;
  ticks: number[];
};

export type PlayerAttackOccurrence = {
  tick: number;
  type: PlayerAttack;
};

export type WeaponCooldownViolationIssue = {
  kind: 'WEAPON_COOLDOWN_VIOLATION';
  player: string;
  previous: PlayerAttackOccurrence;
  current: PlayerAttackOccurrence;
  cooldown: number;
};

export type DeathBeforeSpawnIssue = {
  kind: 'DEATH_BEFORE_SPAWN';
  roomId: number;
  deathTick: number;
  /** First observed spawn tick for this roomId, if one ever appears. */
  spawnTick: number | null;
};

export type PhaseOccurrence = {
  eventType: EventType;
  identityKey: string;
  tick: number;
};

export type PhaseOutOfOrderIssue = {
  kind: 'PHASE_OUT_OF_ORDER';
  previous: PhaseOccurrence;
  current: PhaseOccurrence;
};

export type AttackTargetMissingIssue = {
  kind: 'ATTACK_TARGET_MISSING';
  tick: number;
  attackerKind: 'player' | 'npc';
  attackerId: string;
  targetKind: 'player' | 'npc';
  targetId: string;
};

/**
 * Emitted when an event type appears on a tick alongside another event type
 * it is mutually exclusive with (e.g. `TOB_BLOAT_DOWN` and `TOB_BLOAT_UP`).
 */
export type ExclusiveEventViolationIssue = {
  kind: 'EXCLUSIVE_EVENT_VIOLATION';
  exclusiveTypes: [EventType, EventType];
  tick: number;
};

/**
 * Why a merge step was rejected.
 */
export const enum RejectionReason {
  /** The merged timeline violated a game invariant. */
  POST_MERGE_CONSISTENCY = 'POST_MERGE_CONSISTENCY',
  /** The merge step's confidence score fell below the acceptance threshold. */
  LOW_MERGE_CONFIDENCE = 'LOW_MERGE_CONFIDENCE',
}

export type StepRejection = {
  reason: RejectionReason;
  issues: MergeConsistencyIssue[];
};

/**
 * Validates game invariants on the merged timeline produced by a single
 * consolidation step. All issues are accumulated.
 */
export class MergeConsistencyChecker {
  private readonly ctx: MergeContext;
  private issues: MergeConsistencyIssue[] = [];

  public constructor(ctx: MergeContext) {
    this.ctx = ctx;
  }

  /**
   * Runs all post-merge consistency checks against `ticks` and returns any
   * issues found. An empty result indicates the merged step is consistent.
   */
  public check(ticks: TickStateArray): MergeConsistencyIssue[] {
    this.issues = [];

    this.checkActorLifecycles(ticks);
    this.checkStreamEvents(ticks);
    this.checkWeaponCooldowns(ticks);
    this.checkAttackTargetPresence(ticks);
    this.checkExclusiveEventTypes(ticks);

    return this.issues;
  }

  private checkActorLifecycles(ticks: TickStateArray): void {
    const playerDeathTicks = new Map<string, number[]>();
    const npcSpawnOccurrences = new Map<
      number,
      { tick: number; npcId: number }[]
    >();
    const npcDeathOccurrences = new Map<
      number,
      { tick: number; npcId: number }[]
    >();

    for (const tickState of ticks) {
      if (tickState === null) {
        continue;
      }
      const tick = tickState.getTick();

      for (const event of tickState.getEventsByType(Event.Type.PLAYER_DEATH)) {
        const name = event.getPlayer()!.getName();
        const arr = playerDeathTicks.get(name) ?? [];
        arr.push(tick);
        playerDeathTicks.set(name, arr);
      }

      for (const event of tickState.getEventsByType(Event.Type.NPC_SPAWN)) {
        const npc = event.getNpc()!;
        const roomId = npc.getRoomId();
        const arr = npcSpawnOccurrences.get(roomId) ?? [];
        arr.push({ tick, npcId: npc.getId() });
        npcSpawnOccurrences.set(roomId, arr);
      }

      for (const event of tickState.getEventsByType(Event.Type.NPC_DEATH)) {
        const npc = event.getNpc()!;
        const roomId = npc.getRoomId();
        const arr = npcDeathOccurrences.get(roomId) ?? [];
        arr.push({ tick, npcId: npc.getId() });
        npcDeathOccurrences.set(roomId, arr);
      }
    }

    for (const [player, deathTicks] of playerDeathTicks) {
      if (deathTicks.length > 1) {
        this.issues.push({
          kind: 'DUPLICATE_PLAYER_DEATH',
          player,
          ticks: deathTicks,
        });
      }
    }

    for (const [roomId, occurrences] of npcSpawnOccurrences) {
      if (occurrences.length > 1) {
        this.issues.push({
          kind: 'DUPLICATE_NPC_SPAWN',
          roomId,
          occurrences,
        });
      }
    }

    for (const [roomId, occurrences] of npcDeathOccurrences) {
      if (occurrences.length > 1) {
        this.issues.push({
          kind: 'DUPLICATE_NPC_DEATH',
          roomId,
          occurrences,
        });
      }
    }

    // Every NPC death must have a preceding spawn.
    for (const [roomId, deaths] of npcDeathOccurrences) {
      const earliestDeath = deaths[0].tick;
      const spawns = npcSpawnOccurrences.get(roomId);
      const earliestSpawn = spawns?.[0].tick ?? null;
      if (earliestSpawn === null || earliestSpawn >= earliestDeath) {
        this.issues.push({
          kind: 'DEATH_BEFORE_SPAWN',
          roomId,
          deathTick: earliestDeath,
          spawnTick: earliestSpawn,
        });
      }
    }
  }

  private checkStreamEvents(ticks: TickStateArray): void {
    // Every `temporalWindow: null` stream event is expected to appear at most
    // once per (type, identity). Actor-lifecycle events are handled separately
    // by `checkActorLifecycles` and excluded here to avoid double-reporting.
    const occurrences = new Map<StreamEventType, Map<string, number[]>>();
    const excluded: ReadonlySet<StreamEventType> = new Set([
      Event.Type.PLAYER_DEATH,
      Event.Type.NPC_SPAWN,
      Event.Type.NPC_DEATH,
    ]);

    // For events with ordering rules, track the latest occurrence seen.
    const stageRules = ORDERING_RULES.get(this.ctx.stage) ?? [];
    const previousByRule = new Map<
      OrderingRule,
      { ordinal: number; occurrence: PhaseOccurrence }
    >();

    for (const tickState of ticks) {
      if (tickState === null) {
        continue;
      }
      const tick = tickState.getTick();

      for (const event of tickState.getEvents()) {
        const type = event.getType();
        if (!isStreamEventType(type) || excluded.has(type)) {
          continue;
        }
        const config = STREAM_EVENT_CONFIGS[type];
        if (config.temporalWindow !== null) {
          continue;
        }

        const identityKey = config.identityKey(event);

        const byKey = occurrences.get(type) ?? new Map<string, number[]>();
        occurrences.set(type, byKey);
        const ticksForKey = byKey.get(identityKey) ?? [];
        ticksForKey.push(tick);
        byKey.set(identityKey, ticksForKey);

        for (const rule of stageRules) {
          if (!rule.eventTypes.has(type)) {
            continue;
          }
          const ordinal = rule.extractOrdinal(event, type);
          const current: PhaseOccurrence = {
            eventType: type,
            identityKey,
            tick,
          };
          const prev = previousByRule.get(rule);
          if (prev !== undefined && ordinal < prev.ordinal) {
            this.issues.push({
              kind: 'PHASE_OUT_OF_ORDER',
              previous: prev.occurrence,
              current,
            });
          }
          previousByRule.set(rule, { ordinal, occurrence: current });
        }
      }
    }

    for (const [eventType, byKey] of occurrences) {
      for (const [identityKey, ticksForKey] of byKey) {
        if (ticksForKey.length > 1) {
          this.issues.push({
            kind: 'DUPLICATE_STREAM_EVENT',
            eventType,
            identityKey,
            ticks: ticksForKey,
          });
        }
      }
    }
  }

  private checkWeaponCooldowns(ticks: TickStateArray): void {
    // Most recent attacks by player. The plugin's `isOffCooldownOn` gate means
    // a single client's stream never contains attacks that violate cooldown in
    // its own tick space; any violation in the merged stream is therefore a
    // merger artifact.
    const lastAttack = new Map<string, PlayerAttackOccurrence>();

    for (const tickState of ticks) {
      if (tickState === null) {
        continue;
      }
      const tick = tickState.getTick();

      for (const [name, state] of tickState.getPlayerStates()) {
        if (state === null) {
          continue;
        }
        if (state.attack === null) {
          continue;
        }
        const current: PlayerAttackOccurrence = {
          tick,
          type: state.attack.type,
        };
        const previous = lastAttack.get(name);
        if (previous !== undefined) {
          const cooldown = attackDefinitionsById.get(previous.type)?.cooldown;
          if (cooldown !== undefined && tick - previous.tick < cooldown) {
            this.issues.push({
              kind: 'WEAPON_COOLDOWN_VIOLATION',
              player: name,
              previous,
              current,
              cooldown,
            });
          }
        }
        lastAttack.set(name, current);
      }
    }
  }

  private checkAttackTargetPresence(ticks: TickStateArray): void {
    // When an attack carries a non-null target, the target must be present in
    // the same tick's state map. The plugin only sets a target it can
    // observe, so passthrough preserves this. The merger combines attack and
    // target data across multiple clients, so a merge bug could drop the
    // target's state while keeping the attack's reference to it.
    for (const tickState of ticks) {
      if (tickState === null) {
        continue;
      }
      const tick = tickState.getTick();
      const npcs = tickState.getNpcs();
      const players = tickState.getPlayerStates();

      for (const [name, state] of players) {
        if (state === null) {
          continue;
        }
        const target = state.attack?.target;
        if (target === null || target === undefined) {
          continue;
        }
        if (!npcs.has(target.roomId)) {
          this.issues.push({
            kind: 'ATTACK_TARGET_MISSING',
            tick,
            attackerKind: 'player',
            attackerId: name,
            targetKind: 'npc',
            targetId: String(target.roomId),
          });
        }
      }

      for (const [roomId, state] of npcs) {
        const targetName = state.attack?.target;
        if (targetName === null || targetName === undefined) {
          continue;
        }
        if (!players.get(targetName)) {
          this.issues.push({
            kind: 'ATTACK_TARGET_MISSING',
            tick,
            attackerKind: 'npc',
            attackerId: String(roomId),
            targetKind: 'player',
            targetId: targetName,
          });
        }
      }
    }
  }

  private checkExclusiveEventTypes(ticks: TickStateArray): void {
    const pairs = EXCLUSIVE_EVENT_PAIRS.get(this.ctx.stage);
    if (pairs === undefined || pairs.length === 0) {
      return;
    }

    for (const tickState of ticks) {
      if (tickState === null) {
        continue;
      }
      const tick = tickState.getTick();

      for (const [a, b] of pairs) {
        const hasA = tickState.getEventsByType(a).length > 0;
        const hasB = tickState.getEventsByType(b).length > 0;
        if (hasA && hasB) {
          this.issues.push({
            kind: 'EXCLUSIVE_EVENT_VIOLATION',
            exclusiveTypes: [a, b],
            tick,
          });
        }
      }
    }
  }
}
