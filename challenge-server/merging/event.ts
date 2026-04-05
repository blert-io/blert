import { NpcAttack, PlayerAttack } from '@blert/common';
import { Event } from '@blert/common/generated/event_pb';

export type EventType = Event.TypeMap[keyof Event.TypeMap];

export const SYNTHETIC_EVENT_SOURCE = 0;

/**
 * An event paired with merge pipeline metadata.
 *
 * Mutated by stages of the merge pipeline to attach metadata.
 * A `source` of `SYNTHETIC_EVENT_SOURCE` indicates that the event did not
 * originate from any client.
 */
export type TaggedEvent = {
  event: Event;
  source: number;
};

/**
 * Utility type that asserts two types are equal. Used to enforce exhaustive
 * event classification at compile time.
 */
type Assert<_T extends true> = never;
type Equals<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/**
 * Event types that no longer exist in the protocol and are never processed.
 */
type DeprecatedEventType =
  | typeof Event.Type.DEPRECATED_CHALLENGE_START
  | typeof Event.Type.DEPRECATED_CHALLENGE_END
  | typeof Event.Type.DEPRECATED_CHALLENGE_UPDATE
  | typeof Event.Type.DEPRECATED_STAGE_UPDATE;

/**
 * Event types from solo-only challenges (Colosseum, Mokhaiotl, Inferno) that
 * never go through the merge path.
 */
type SoloEventType =
  | typeof Event.Type.COLOSSEUM_HANDICAP_CHOICE
  | typeof Event.Type.COLOSSEUM_DOOM_APPLIED
  | typeof Event.Type.COLOSSEUM_TOTEM_HEAL
  | typeof Event.Type.COLOSSEUM_REENTRY_POOLS
  | typeof Event.Type.COLOSSEUM_SOL_DUST
  | typeof Event.Type.COLOSSEUM_SOL_GRAPPLE
  | typeof Event.Type.COLOSSEUM_SOL_POOLS
  | typeof Event.Type.COLOSSEUM_SOL_LASERS
  | typeof Event.Type.MOKHAIOTL_ATTACK_STYLE
  | typeof Event.Type.MOKHAIOTL_ORB
  | typeof Event.Type.MOKHAIOTL_OBJECTS
  | typeof Event.Type.MOKHAIOTL_LARVA_LEAK
  | typeof Event.Type.MOKHAIOTL_SHOCKWAVE
  | typeof Event.Type.INFERNO_WAVE_START;

/**
 * Event types that are derived from the final merged timeline rather than
 * being reconciled from client data.
 */
type DerivedEventType =
  | typeof Event.Type.TOB_NYLO_WAVE_STALL
  | typeof Event.Type.TOB_NYLO_CLEANUP_END
  | typeof Event.Type.TOB_NYLO_BOSS_SPAWN;

/**
 * Player event types that are merged tick-by-tick using PRIMARY/SECONDARY
 * data source priority.
 *
 * TODO(frolv): PLAYER_ATTACK and PLAYER_SPELL are tick-state temporarily
 * until enough test data to understand spell/attack desync exists.
 */
export type PlayerTickStateEventType =
  | typeof Event.Type.PLAYER_UPDATE
  | typeof Event.Type.PLAYER_ATTACK
  | typeof Event.Type.PLAYER_SPELL;

const PLAYER_TICK_STATE_RECORD: Record<PlayerTickStateEventType, true> = {
  [Event.Type.PLAYER_UPDATE]: true,
  [Event.Type.PLAYER_ATTACK]: true,
  [Event.Type.PLAYER_SPELL]: true,
};

export const PLAYER_TICK_STATE_TYPES: ReadonlySet<EventType> = new Set(
  Object.keys(PLAYER_TICK_STATE_RECORD).map(Number) as EventType[],
);

/**
 * Graphics and positional event types that are merged tick-by-tick. Both
 * sides' events are kept without deduplication because some are delta-based
 * and resolved during resynchronization.
 */
export type GraphicsEventType =
  | typeof Event.Type.TOB_MAIDEN_BLOOD_SPLATS
  | typeof Event.Type.TOB_BLOAT_HANDS_DROP
  | typeof Event.Type.TOB_BLOAT_HANDS_SPLAT
  | typeof Event.Type.TOB_XARPUS_SPLAT
  | typeof Event.Type.TOB_VERZIK_YELLOWS
  | typeof Event.Type.TOB_VERZIK_REDS_SPAWN
  | typeof Event.Type.TOB_SOTE_MAZE_PATH;

const GRAPHICS_EVENT_RECORD: Record<GraphicsEventType, true> = {
  [Event.Type.TOB_MAIDEN_BLOOD_SPLATS]: true,
  [Event.Type.TOB_BLOAT_HANDS_DROP]: true,
  [Event.Type.TOB_BLOAT_HANDS_SPLAT]: true,
  [Event.Type.TOB_XARPUS_SPLAT]: true,
  [Event.Type.TOB_VERZIK_YELLOWS]: true,
  [Event.Type.TOB_VERZIK_REDS_SPAWN]: true,
  [Event.Type.TOB_SOTE_MAZE_PATH]: true,
};

export const GRAPHICS_EVENT_TYPES: ReadonlySet<EventType> = new Set(
  Object.keys(GRAPHICS_EVENT_RECORD).map(Number) as EventType[],
);

/**
 * NPC event types merged tick-by-tick: missing NPCs are added from the
 * target.
 *
 * TODO(frolv): NPC_ATTACK is tick-state temporarily until enough test data to
 * understand desync exists.
 */
type NpcTickStateEventType =
  | typeof Event.Type.NPC_UPDATE
  | typeof Event.Type.NPC_ATTACK;

/**
 * All event types representing per-tick game state, merged on a tick-by-tick
 * basis.
 */
export type TickStateEventType =
  | PlayerTickStateEventType
  | NpcTickStateEventType
  | GraphicsEventType;

/**
 * Event types that are deferred from the tick-by-tick merge and collected
 * into per-client buffers for stream reconciliation (temporal dedup).
 */
export type StreamEventType =
  | typeof Event.Type.PLAYER_DEATH
  | typeof Event.Type.NPC_SPAWN
  | typeof Event.Type.NPC_DEATH
  | typeof Event.Type.TOB_MAIDEN_CRAB_LEAK
  | typeof Event.Type.TOB_BLOAT_DOWN
  | typeof Event.Type.TOB_BLOAT_UP
  | typeof Event.Type.TOB_NYLO_WAVE_SPAWN
  | typeof Event.Type.TOB_SOTE_MAZE_PROC
  | typeof Event.Type.TOB_SOTE_MAZE_END
  | typeof Event.Type.TOB_XARPUS_PHASE
  | typeof Event.Type.TOB_XARPUS_EXHUMED
  | typeof Event.Type.TOB_VERZIK_PHASE
  | typeof Event.Type.TOB_VERZIK_DAWN_DROP
  | typeof Event.Type.TOB_VERZIK_HEAL;

/**
 * Event types that augment a previous attack with additional context.
 * These are resolved by mapping them back to their attack in the merged
 * timeline rather than being temporally deduped.
 */
export type AttackMappedEventType =
  | typeof Event.Type.TOB_VERZIK_ATTACK_STYLE
  | typeof Event.Type.TOB_VERZIK_BOUNCE
  | typeof Event.Type.TOB_VERZIK_DAWN;

// Compile-time check: every EventType must be classified into exactly one
// category. Adding a new event type to the proto without classifying it here
// will cause a compile error.
type _ExhaustiveClassification = Assert<
  Equals<
    EventType,
    | DeprecatedEventType
    | SoloEventType
    | DerivedEventType
    | TickStateEventType
    | StreamEventType
    | AttackMappedEventType
  >
>;

/**
 * Extracts a deduplication identity key from a stream event. Events with the
 * same key from different clients are candidates for temporal matching.
 */
type IdentityKeyFn = (event: Event) => string;

/**
 * Configuration for deduplicating a stream event type.
 */
export type StreamEventConfig = {
  /** Extracts the identity key from an event. */
  identityKey: IdentityKeyFn;
  /**
   * Maximum tick gap within which two events are considered the same.
   * If null, the event is unique within the stage.
   */
  temporalWindow: number | null;
};

function actorIdKey(event: Event): string {
  const player = event.getPlayer();
  if (player !== undefined) {
    return player.getName();
  }
  const npc = event.getNpc();
  if (npc !== undefined) {
    return String(npc.getRoomId());
  }
  return '';
}

function singletonKey(_event: Event): string {
  return '';
}

/**
 * Record ensuring every stream event type has a dedup config. Adding a new
 * StreamEventType without a config entry here will cause a compile error.
 */
export const STREAM_EVENT_CONFIGS: Record<StreamEventType, StreamEventConfig> =
  {
    // Deaths are keyed by actor with a moderate window since clients can see
    // them several ticks apart depending on how they detect the death.
    [Event.Type.PLAYER_DEATH]: { identityKey: actorIdKey, temporalWindow: 5 },
    [Event.Type.NPC_DEATH]: { identityKey: actorIdKey, temporalWindow: 5 },

    [Event.Type.NPC_SPAWN]: { identityKey: actorIdKey, temporalWindow: null },

    [Event.Type.TOB_MAIDEN_CRAB_LEAK]: {
      identityKey: actorIdKey,
      temporalWindow: null,
    },

    // Bloat downs are distinguished temporally.
    [Event.Type.TOB_BLOAT_DOWN]: {
      identityKey: singletonKey,
      temporalWindow: 32,
    },
    [Event.Type.TOB_BLOAT_UP]: {
      identityKey: singletonKey,
      temporalWindow: 32,
    },

    // Nylocas wave spawns keyed by wave number.
    [Event.Type.TOB_NYLO_WAVE_SPAWN]: {
      identityKey: (e) => String(e.getNyloWave()?.getWave() ?? 0),
      temporalWindow: 3,
    },

    // Sotetseg maze events keyed by maze number.
    [Event.Type.TOB_SOTE_MAZE_PROC]: {
      identityKey: (e) => String(e.getSoteMaze()?.getMaze() ?? 0),
      temporalWindow: null,
    },
    [Event.Type.TOB_SOTE_MAZE_END]: {
      identityKey: (e) => String(e.getSoteMaze()?.getMaze() ?? 0),
      temporalWindow: null,
    },

    [Event.Type.TOB_XARPUS_PHASE]: {
      identityKey: (e) => String(e.getXarpusPhase()),
      temporalWindow: null,
    },
    [Event.Type.TOB_XARPUS_EXHUMED]: {
      identityKey: (e) => `${e.getXCoord()},${e.getYCoord()}`,
      temporalWindow: 16,
    },

    [Event.Type.TOB_VERZIK_PHASE]: {
      identityKey: (e) => String(e.getVerzikPhase()),
      temporalWindow: null,
    },
    // Dawn drops repeat every 4 ticks with alternating dropped values.
    // Key by dropped value with a tight window to avoid crossing cycles.
    [Event.Type.TOB_VERZIK_DAWN_DROP]: {
      identityKey: (e) => String(e.getVerzikDawnDrop()?.getDropped() ?? false),
      temporalWindow: 3,
    },

    // Verzik heals keyed by player name and distinct temporally.
    [Event.Type.TOB_VERZIK_HEAL]: {
      identityKey: (e) => e.getVerzikHeal()?.getPlayer() ?? '',
      temporalWindow: 30,
    },
  };

const ATTACK_MAPPED_EVENT_RECORD: Record<AttackMappedEventType, true> = {
  [Event.Type.TOB_VERZIK_ATTACK_STYLE]: true,
  [Event.Type.TOB_VERZIK_BOUNCE]: true,
  [Event.Type.TOB_VERZIK_DAWN]: true,
};

export const ATTACK_MAPPED_EVENT_TYPES: ReadonlySet<AttackMappedEventType> =
  new Set(
    Object.keys(ATTACK_MAPPED_EVENT_RECORD).map(
      Number,
    ) as AttackMappedEventType[],
  );

/**
 * All event types that are extracted from ticks during the build step and
 * buffered for reconciliation. This is the union of stream and attack-mapped
 * types.
 */
export const BUFFERED_EVENT_TYPES: ReadonlySet<EventType> = new Set([
  ...(Object.keys(STREAM_EVENT_CONFIGS).map(Number) as EventType[]),
  ...(Object.keys(ATTACK_MAPPED_EVENT_RECORD).map(Number) as EventType[]),
]);

/**
 * Creates a copy of an event with all its tick references remapped using the
 * provided mapping function.
 *
 * @param tagged The event to remap.
 * @param remap Maps a tick in the event's source tick space to the merged
 *   tick space.
 * @returns The remapped event.
 */
export function remapEventTick(
  tagged: TaggedEvent,
  remap: (tick: number) => number,
): TaggedEvent {
  const remapped = {
    ...tagged,
    event: tagged.event.clone(),
  };

  remapped.event.setTick(remap(remapped.event.getTick()));

  switch (remapped.event.getType()) {
    case Event.Type.PLAYER_UPDATE: {
      const player = remapped.event.getPlayer()!;
      player.setOffCooldownTick(remap(player.getOffCooldownTick()));
      break;
    }

    case Event.Type.TOB_XARPUS_EXHUMED: {
      const xarpusExhumed = remapped.event.getXarpusExhumed()!;
      xarpusExhumed.setSpawnTick(remap(xarpusExhumed.getSpawnTick()));
      xarpusExhumed.setHealTicksList(
        xarpusExhumed.getHealTicksList().map(remap),
      );
      break;
    }

    case Event.Type.TOB_VERZIK_ATTACK_STYLE: {
      const style = remapped.event.getVerzikAttackStyle()!;
      style.setNpcAttackTick(remap(style.getNpcAttackTick()));
      break;
    }

    case Event.Type.TOB_VERZIK_BOUNCE: {
      const bounce = remapped.event.getVerzikBounce()!;
      bounce.setNpcAttackTick(remap(bounce.getNpcAttackTick()));
      break;
    }

    case Event.Type.TOB_VERZIK_DAWN: {
      const dawn = remapped.event.getVerzikDawn()!;
      dawn.setAttackTick(remap(dawn.getAttackTick()));
      break;
    }

    case Event.Type.MOKHAIOTL_ATTACK_STYLE: {
      const style = remapped.event.getMokhaiotlAttackStyle()!;
      style.setNpcAttackTick(remap(style.getNpcAttackTick()));
      break;
    }
  }

  return remapped;
}

// Some player and NPC attacks share the same animation and are identified by
// which projectile is fired. However, projectiles have a shorter render
// distance than actors, so two clients could report contradictory attacks from
// the same actor on what is legitimately the same tick.
const ATTACKS_NORMALIZED_FOR_PROJECTILE = new Map<number, number>([
  // Deliberately ignore DAWN_AUTO/DAWN_SPEC as there isn't a realistic case
  // where someone would be out of render distance of the projectile.
  [PlayerAttack.BLOWPIPE, PlayerAttack.BLOWPIPE],
  [PlayerAttack.BLOWPIPE_SPEC, PlayerAttack.BLOWPIPE],
  [PlayerAttack.ZCB_AUTO, PlayerAttack.ZCB_AUTO],
  [PlayerAttack.ZCB_SPEC, PlayerAttack.ZCB_AUTO],

  [NpcAttack.TOB_SOTE_BALL, NpcAttack.TOB_SOTE_BALL],
  [NpcAttack.TOB_SOTE_DEATH_BALL, NpcAttack.TOB_SOTE_BALL],
]);

/**
 * Normalizes an attack type by collapsing projectile-ambiguous variants to
 * a canonical value.
 */
export function normalizeAttackType(attack: number): number {
  return ATTACKS_NORMALIZED_FOR_PROJECTILE.get(attack) ?? attack;
}

/** Returns whether two attack types differ only by projectile. */
export function areProjectileAmbiguous(a: number, b: number): boolean {
  return a !== b && normalizeAttackType(a) === normalizeAttackType(b);
}
