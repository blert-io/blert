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
  /** Optional display hints for enhanced rendering. */
  augmentation?: BCFAugmentation;
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
  /** Ordered list of actor/custom row IDs defining display order. */
  rowOrder?: string[];
  /** Pinned canonical definition sources. */
  definitions?: BCFDefinitions;
}

/**
 * URLs to canonical definition files for attack/spell type resolution.
 */
export interface BCFDefinitions {
  /** URL to attack_definitions.json. */
  attacks?: string;
  /** URL to spell_definitions.json. */
  spells?: string;
  /** URL to event.proto (for NpcAttack enum). */
  npcAttacks?: string;
}

/**
 * Core timeline data containing actors and ticks.
 */
export interface BCFTimeline<ActionType extends { type: string } = BCFAction> {
  /** Actors (rows) in the timeline. */
  actors: BCFActor[];
  /** Sparse array of tick objects. */
  ticks: BCFTick<ActionType>[];
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

export type BCFPlayerAction = BCFAttackAction | BCFSpellAction | BCFDeathAction;
export type BCFNpcAction = BCFNpcAttackAction;

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
  /** Spec energy cost. Presence implies that this is a special attack. */
  specCost?: number;
  /** Display overrides. */
  display?: BCFAttackDisplay;
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
  /** Display overrides. */
  display?: BCFSpellDisplay;
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
  /** Display overrides. */
  display?: BCFNpcAttackDisplay;
}

/**
 * An action that is not a known action type.
 */
export type BCFUnknownAction = {
  type: string;
} & Record<string, unknown>;

/**
 * Display override for player attacks.
 */
export interface BCFAttackDisplay {
  /** URL or path to icon image. */
  iconUrl?: string;
  /** Short text for compact display mode (1-3 characters). */
  letter?: string;
  /** Combat style. */
  style?: 'melee' | 'ranged' | 'magic';
}

/**
 * Display override for spells.
 */
export interface BCFSpellDisplay {
  /** URL or path to spell icon. */
  iconUrl?: string;
  /** Spell name for tooltips. */
  name?: string;
}

/**
 * Display override for NPC attacks.
 */
export interface BCFNpcAttackDisplay {
  /** URL or path to attack icon. */
  iconUrl?: string;
  /** Description for tooltips. */
  description?: string;
}

interface BCFStateBase {
  /** Additional state indicators. Does not persist. */
  customStates?: BCFCustomState[];
}

export type BCFState = BCFPlayerState | BCFNpcState;

export interface BCFPlayerState extends BCFStateBase {
  /** Whether the player is dead. Persists across ticks. */
  isDead?: boolean;
  /** Player was off attack cooldown. Does not persist. */
  offCooldown?: boolean;
  /** Remaining spec energy after action (0-100). Persists across ticks. */
  specEnergy?: number;
}

export interface BCFNpcState extends BCFStateBase {
  /** Text label to display. Does not persist. */
  label?: string;
}

/**
 * A custom state annotation.
 */
export interface BCFCustomState {
  /** Short label for display. */
  label: string;
  /** Full description for tooltips. */
  fullText?: string;
  /** Icon to display with the state. */
  iconUrl?: string;
}

/**
 * Optional display hints that enhance rendering.
 */
export interface BCFAugmentation {
  /** Split markers at significant points. */
  splits?: BCFSplit[];
  /** Background color highlights for tick ranges. */
  backgroundColors?: BCFBackgroundColor[];
  /** Custom rows for challenge-specific data. */
  customRows?: BCFCustomRow[];
}

/**
 * A split marker at a significant point in the timeline.
 */
export interface BCFSplit {
  /** Tick on which the split occurs. */
  tick: number;
  /** Split label. */
  name: string;
  /** Whether to emphasize this split visually. Defaults to true. */
  isImportant?: boolean;
}

/**
 * A background color highlight for a tick range.
 */
export interface BCFBackgroundColor {
  /** Starting tick. */
  tick: number;
  /** Number of ticks to color. Defaults to 1. */
  length?: number;
  /** Hex color (#RRGGBB or #RRGGBBAA). */
  color: string;
  /** Actor/custom row IDs to color. If omitted, applies to all rows. */
  rowIds?: string[];
}

/**
 * A custom row for challenge-specific data.
 */
export interface BCFCustomRow {
  /** Unique identifier. Must not conflict with actor IDs. */
  id: string;
  /** Display name shown in the legend. */
  name: string;
  /** Sparse array of cells. */
  cells: BCFCustomRowCell[];
}

/**
 * A cell in a custom row.
 */
export interface BCFCustomRowCell {
  /** Tick number for this cell. */
  tick: number;
  /** Icon URL to display. */
  iconUrl?: string;
  /** Short text label (1-3 characters). */
  label?: string;
  /** Opacity (0.0-1.0). Defaults to 1.0. */
  opacity?: number;
}
