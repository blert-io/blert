/**
 * Blert Chart Format (BCF) TypeScript Types
 *
 * These types match the BCF 1.0 specification. See docs/spec.md for details.
 */

/**
 * A BCF document representing a combat timeline.
 */
export interface BlertChartFormat<
  ActionType extends { type: string } = BCFAction,
> {
  /** BCF specification version. Must be "1.0". */
  version: '1.0';
  /** Human-readable name for the chart. */
  name?: string;
  /** Longer description or notes. */
  description?: string;
  /** Timeline configuration. */
  config: BCFConfig;
  /** Core timeline data (actors and ticks). */
  timeline: BCFTimeline<ActionType>;
}

/**
 * Timeline configuration parameters.
 */
export interface BCFConfig {
  /** Total number of ticks in the timeline. */
  totalTicks: number;
  /** First display tick in the timeline. */
  startTick?: number;
  /** Last display tick in the timeline (inclusive). */
  endTick?: number;
  /** Ordered list of actor IDs defining display order. */
  rowOrder?: string[];
}

/**
 * Core timeline data containing actors and ticks.
 */
export interface BCFTimeline<ActionType extends { type: string } = BCFAction> {
  /** Actors (rows) in the timeline. */
  actors: BCFActor[];
  /** Sparse array of tick objects. */
  ticks: BCFTick<ActionType>[];
  /** Encounter-level phase transitions. */
  phases?: BCFPhase[];
}

/**
 * An encounter-level phase transition.
 */
export interface BCFPhase {
  /** Tick number when the phase begins. */
  tick: number;
  /** Phase type identifier (e.g., `"NYLOCAS_WAVE_5"`). */
  phaseType: string;
}

/**
 * An actor in the timeline (player or NPC).
 */
export type BCFActor = BCFPlayerActor | BCFNpcActor;

interface BCFActorBase {
  /** Unique identifier within the document. */
  id: string;
  /** Display name. */
  name: string;
}

/**
 * A player actor.
 */
export interface BCFPlayerActor extends BCFActorBase {
  type: 'player';
}

/**
 * An NPC actor.
 */
export interface BCFNpcActor extends BCFActorBase {
  type: 'npc';
  /** OSRS NPC ID at spawn. */
  npcId: number;
  /** First tick the NPC exists. Defaults to 0 if omitted. */
  spawnTick?: number;
  /** Tick the NPC dies; permanent removal from the timeline. */
  deathTick?: number;
}

/**
 * A single tick in the timeline.
 */
export interface BCFTick<ActionType extends { type: string } = BCFAction> {
  /** Tick number. */
  tick: number;
  /** Cells for actors that have data on this tick. */
  cells: BCFCell<ActionType>[];
}

/**
 * A cell representing an actor's data on a specific tick.
 */
export interface BCFCell<ActionType extends { type: string } = BCFAction> {
  /** References an actor's `id`. */
  actorId: string;
  /** Actions performed by the actor. */
  actions?: ActionType[];
  /** Actor state on this tick. */
  state?: BCFState;
}

/**
 * An action performed by an actor on a tick.
 */
export type BCFAction = BCFPlayerAction | BCFNpcAction;

export type BCFPlayerAction =
  | BCFAttackAction
  | BCFSpellAction
  | BCFUtilityAction
  | BCFDeathAction;
export type BCFNpcAction = BCFNpcAttackAction | BCFNpcPhaseAction;

export type BCFLaxAction = BCFAction | BCFUnknownAction;

export type BlertChartFormatStrict = BlertChartFormat<BCFAction>;
export type BlertChartFormatLax = BlertChartFormat<BCFLaxAction>;

/**
 * A player attack action.
 */
export interface BCFAttackAction {
  type: 'attack';
  /** Attack type identifier (e.g., `"SCYTHE"`, `"DAWN_SPEC"`). */
  attackType: string;
  /** OSRS item ID of the weapon. */
  weaponId?: number;
  /** Weapon name for display. */
  weaponName?: string;
  /** Target actor's ID. */
  targetActorId?: string;
  /** Tiles away from target. */
  distanceToTarget?: number;
  /** Damage dealt by the attack. */
  damage?: number;
  /** Spec energy cost for special attacks. */
  specCost?: number;
}

/**
 * A player spell action.
 */
export interface BCFSpellAction {
  type: 'spell';
  /** Spell type identifier (e.g., `"VENGEANCE"`, `"DEATH_CHARGE"`). */
  spellType: string;
  /** Target actor's ID (if applicable). */
  targetActorId?: string;
}

/**
 * A player utility action.
 */
export interface BCFUtilityAction {
  type: 'utility';
  /** Utility type identifier (e.g., `"SURGE_POTION"`). */
  utilityType: string;
}

/**
 * A player death action.
 */
export interface BCFDeathAction {
  type: 'death';
}

/**
 * An NPC attack action.
 */
export interface BCFNpcAttackAction {
  type: 'npcAttack';
  /** NPC attack type identifier (e.g., `"TOB_VERZIK_P2_BOUNCE"`). */
  attackType: string;
  /** Target actor's ID. */
  targetActorId?: string;
}

/**
 * An NPC phase transition action.
 */
export interface BCFNpcPhaseAction {
  type: 'npcPhase';
  /** NPC phase type identifier (e.g., `"VERZIK_P2"`). */
  phaseType: string;
}

/**
 * An action that is not a known action type.
 */
export type BCFUnknownAction = {
  type: string;
} & Record<string, unknown>;

export type BCFState = BCFPlayerState | BCFNpcState;

/**
 * Player state on a tick.
 */
export interface BCFPlayerState {
  /** Whether the player is dead. Persists across ticks. */
  isDead?: boolean;
  /** Player was off attack cooldown. Does not persist. */
  offCooldown?: boolean;
  /** Remaining spec energy after action (0-100). Persists across ticks. */
  specEnergy?: number;
}

/**
 * NPC state on a tick.
 *
 * Currently empty as there is no NPC-specific state.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface BCFNpcState {}
