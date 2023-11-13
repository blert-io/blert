import styles from './style.module.css';

export const enum EntityType {
  OVERLAY,
  PLAYER,
  NPC,
  HIGHLIGHT,
  CUSTOM,
}

/**
 * An `Entity` represents anything which is renderable on a game map.
 * Examples include in-game characters or objects, or additional display
 * information such as a highlighted tile.
 */
export interface Entity {
  /** Global x-coordinate of the entity. */
  readonly x: number;

  /** Global y-coordinate of the entity. */
  readonly y: number;

  /** Type of entity being rendered. */
  readonly type: EntityType;

  /** Entity's size in tiles. */
  readonly size: number;

  /** Color with which the entity's map position should be outlined.  */
  readonly outlineColor: string | null;

  /** Whether or not the entity can be interacted with on the map. */
  readonly interactable: boolean;

  /** Renders the internal contents of an entity displayed on a map. */
  renderContents(): React.ReactNode;

  /**
   * Returns an identifier for this entity sufficiently unique to distinguish
   * it from other entities.
   */
  getUniqueId(): string;
}

function entityZIndex(type: EntityType): number {
  const BASE_Z_INDEX: number = 10;
  return BASE_Z_INDEX - type;
}

type MapEntityProps = {
  baseX: number;
  baseY: number;
  entity: Entity;
  tileSize: number;
};

export function MapEntity(props: MapEntityProps) {
  const entity = props.entity;

  const size = entity.size * props.tileSize;

  // Position the entity based on its southwest corner tile.
  const left = (entity.x - props.baseX) * props.tileSize;
  const bottom = (entity.y - props.baseY) * props.tileSize;

  const border =
    entity.outlineColor !== null
      ? `1px solid ${entity.outlineColor}`
      : undefined;

  return (
    <div
      className={styles.entity}
      data-type={entity.type}
      data-x={entity.x}
      data-y={entity.y}
      style={{
        border,
        left,
        bottom,
        height: size,
        width: size,
        zIndex: entityZIndex(entity.type),
      }}
    >
      {entity.renderContents()}
    </div>
  );
}
