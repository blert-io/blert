import { Coords, getNpcDefinition, SkillLevel } from '@blert/common';

import { Terrain } from './path';

export type MapDefinition = {
  baseX: number;
  baseY: number;
  width: number;
  height: number;
  initialCameraPosition?: Coords;
  initialZoom?: number;
  terrain?: Terrain;
};

export const enum EntityType {
  PLAYER,
  NPC,
  GROUND_OBJECT,
}

/**
 * Represents the current interpolation state for an entity
 */
export interface InterpolationState {
  /** The waypoints to animate along during the current tick */
  waypoints: Coords[];
  /** Timestamp when the current tick animation started */
  startTime: number;
  /** Duration of the current tick animation in milliseconds */
  tickDuration: number;
}

/**
 * Configuration for entity interpolation
 */
export interface ReplayConfig {
  /** Whether interpolation is enabled */
  interpolationEnabled: boolean;
  /** Duration of a single game tick in milliseconds */
  tickDuration: number;
  /** Whether debug mode is enabled */
  debug: boolean;
}

/**
 * Actor interaction state
 */
export interface ActorInteractionState {
  /** ID of the currently selected actor */
  selectedActorId: string | null;
  /** ID of the currently hovered actor */
  hoveredActorId: string | null;
}

/**
 * An `Entity` represents anything which is renderable on a game map.
 * Examples include in-game characters or objects, or additional display
 * information such as a highlighted tile.
 */
export interface Entity {
  /** Type of entity being rendered. */
  readonly type: EntityType;

  /** Current position of the entity. */
  position: Coords;

  /** Position at the next tick. */
  nextPosition?: Coords;

  /** Entity's size in tiles. */
  readonly size: number;

  /** User-facing name of the entity. */
  readonly name: string;

  /** Whether or not the entity can be interacted with on the map. */
  readonly interactive: boolean;

  /** Returns a unique identifier for the entity. */
  getUniqueId(): string;
}

type HitpointsState = {
  current: SkillLevel;
  next?: SkillLevel;
};

export class PlayerEntity implements Entity {
  type: EntityType = EntityType.PLAYER;
  size: number = 1;
  interactive: boolean = true;
  hitpoints: HitpointsState | null;

  public constructor(
    public readonly position: Coords,
    public readonly name: string,
    public readonly orb: number,
    hitpoints?: Partial<HitpointsState> | SkillLevel,
    public readonly nextPosition?: Coords,
  ) {
    if (hitpoints instanceof SkillLevel) {
      this.hitpoints = {
        current: hitpoints,
        next: hitpoints,
      };
    } else {
      if (hitpoints?.current) {
        this.hitpoints = hitpoints as HitpointsState;
      }
      this.hitpoints = null;
    }
  }

  public getUniqueId(): string {
    return `${this.type}-${this.name}`;
  }
}

export class NpcEntity implements Entity {
  type: EntityType = EntityType.NPC;
  interactive: boolean = true;
  readonly name: string;
  readonly size: number;
  readonly imageUrl: string;
  hitpoints: HitpointsState | null;

  public constructor(
    public readonly position: Coords,
    public readonly id: number,
    public readonly roomId: number,
    hitpoints: HitpointsState | SkillLevel,
    public readonly nextPosition?: Coords,
  ) {
    const npcDef = getNpcDefinition(this.id);
    if (npcDef !== null) {
      this.name = npcDef.fullName;
      this.size = npcDef.size;

      const imageId = npcDef.semanticId ? id : npcDef.canonicalId;
      this.imageUrl = `/images/npcs/${imageId}.webp`;
    } else {
      this.name = `Unknown NPC ${this.id}`;
      this.size = 1;
      this.imageUrl = '/images/huh.png';
    }

    if (hitpoints instanceof SkillLevel) {
      this.hitpoints = {
        current: hitpoints,
        next: hitpoints,
      };
    } else {
      this.hitpoints = hitpoints ?? null;
    }
  }

  public getUniqueId(): string {
    return `${this.type}-${this.roomId}`;
  }
}

export class GroundObjectEntity implements Entity {
  type: EntityType = EntityType.GROUND_OBJECT;
  interactive: boolean = false;
  readonly name: string;
  readonly size: number;
  readonly imageUrl: string;
  readonly borderColor?: string;

  public constructor(
    public readonly position: Coords,
    imageUrl: string,
    name: string = 'Ground Object',
    size: number = 1,
    borderColor?: string,
  ) {
    this.name = name;
    this.size = size;
    this.imageUrl = imageUrl;
    this.borderColor = borderColor;
  }

  public getUniqueId(): string {
    return `${this.type}-${this.position.x}-${this.position.y}`;
  }
}

/**
 * Utility type for all animated entity types.
 */
export type AnyEntity = PlayerEntity | NpcEntity | GroundObjectEntity;

export interface InteractiveEntityProps<T extends Entity> {
  /** Entity data. */
  entity: T;

  /** Callback when the entity is clicked. */
  onClicked?: (entity: T) => void;

  /** Whether this entity is currently selected. */
  isSelected?: boolean;

  /** Whether this entity is currently hovered. */
  isHovered?: boolean;

  /** If fanning out, the index of this entity in its stack. */
  fanOutIndex?: number;

  /** Size of the stack this entity is in. */
  stackSize: number;

  /** Whether this entity is dimmed. */
  isDimmed?: boolean;
}
