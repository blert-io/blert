import { MouseEvent } from 'react';

import styles from './style.module.scss';

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

  /** User-facing name of the entity. */
  readonly name: string;

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

export function entityTypeString(type: EntityType) {
  switch (type) {
    case EntityType.OVERLAY:
      return 'overlay';
    case EntityType.PLAYER:
      return 'player';
    case EntityType.NPC:
      return 'npc';
    case EntityType.HIGHLIGHT:
      return 'highlight';
    case EntityType.CUSTOM:
      return 'custom';
  }
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
  faceSouth: boolean;
  onSelect?: (entity: Entity) => void;
};

export function MapEntity(props: MapEntityProps) {
  const entity = props.entity;
  const size = entity.size * props.tileSize;

  const border =
    entity.outlineColor !== null
      ? `1px solid ${entity.outlineColor}`
      : undefined;

  const canClick = entity.interactable && props.onSelect;
  let onClick = undefined;
  if (canClick) {
    onClick = (e: MouseEvent) => {
      e.stopPropagation();
      props.onSelect!(entity);
    };
  }

  let entityStyle: React.CSSProperties = {
    border,
    cursor: canClick ? 'pointer' : 'default',
    height: size,
    width: size,
    zIndex: entityZIndex(entity.type),
  };

  if (!entity.interactable) {
    entityStyle.pointerEvents = 'none';
  }

  if (props.faceSouth) {
    entityStyle.right = (entity.x - props.baseX) * props.tileSize + 1;
    entityStyle.top = (entity.y - props.baseY) * props.tileSize;
  } else {
    // Position the entity based on its southwest corner tile.
    entityStyle.left = (entity.x - props.baseX) * props.tileSize + 1;
    entityStyle.bottom = (entity.y - props.baseY) * props.tileSize;
  }

  return (
    <div
      className={styles.entity}
      data-type={entity.type}
      data-x={entity.x}
      data-y={entity.y}
      onClick={onClick}
      style={entityStyle}
    >
      {entity.renderContents()}
    </div>
  );
}
