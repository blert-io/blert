import { Entity, MapEntity, entityTypeString } from './entity';
import Tile, { TileData } from './tile';

import styles from './style.module.scss';
import { OverlayEntity } from './overlay';
import { useState } from 'react';

export type BaseTile = {
  x: number;
  y: number;
  color?: string;
};

type MapProps = {
  x: number;
  y: number;
  width: number;
  height: number;
  baseTiles?: BaseTile[];
  tileSize: number;
  entities: Entity[];
  onEntityClicked?: (entity: Entity) => void;
};

export default function Map(props: MapProps) {
  const [selectedTile, setSelectedTile] = useState<TileData | null>(null);
  const widthPx = props.tileSize * props.width;

  let tiles: TileData[][] = [];
  for (let y = props.y; y < props.y + props.height; y++) {
    let row: TileData[] = [];
    for (let x = props.x; x < props.x + props.width; x++) {
      row.push({ x, y, entities: [] });
    }
    tiles.push(row);
  }

  const getTileForCoords = (x: number, y: number) => {
    if (
      x < props.x ||
      x >= props.x + props.width ||
      y < props.y ||
      y >= props.y + props.height
    ) {
      return null;
    }

    const relX = x - props.x;
    const relY = y - props.y;
    return tiles[relY][relX];
  };

  const baseTiles = props.baseTiles ?? [];
  for (const baseTile of baseTiles) {
    let tile = getTileForCoords(baseTile.x, baseTile.y);
    if (tile === null) {
      console.error(`base tile (${baseTile.x},${baseTile.y}) is out-of-bounds`);
      continue;
    }

    if (baseTile.color) {
      tile.color = baseTile.color;
    }
  }

  // Tiles containing more than a single entity.
  let packedTiles = [];

  for (const entity of props.entities) {
    if (!entity.interactable) {
      continue;
    }

    let tile = getTileForCoords(entity.x, entity.y);
    if (tile !== null) {
      if (tile.entities.length === 1) {
        packedTiles.push(tile);
      }
      tile.entities.push(entity);
    }
  }

  let mapEntities = [...props.entities];

  packedTiles.forEach((tile) => {
    if (
      selectedTile !== null &&
      tile.x === selectedTile.x &&
      tile.y === selectedTile.y
    ) {
      return;
    }
    const entityCount = (
      <button
        className={styles.countOverlay}
        onClick={(e) => {
          e.stopPropagation();
          setSelectedTile(tile);
        }}
      >
        <div className={styles.count}>{tile.entities.length}</div>
      </button>
    );
    mapEntities.push(new OverlayEntity(tile.x, tile.y, 'count', entityCount));
  });

  if (selectedTile !== null) {
    const offset = props.tileSize / 2;
    const xPosition =
      selectedTile.x - props.x > props.width / 2
        ? { right: offset }
        : { left: offset };
    const yPosition =
      selectedTile.y - props.y > props.height / 2
        ? { top: offset }
        : { bottom: offset };
    const entityMenu = (
      <div
        className={styles.menu}
        onClick={(e) => e.stopPropagation()}
        style={{ ...xPosition, ...yPosition }}
      >
        {selectedTile.entities.map((entity) => (
          <button
            key={entity.getUniqueId()}
            onClick={() => {
              setSelectedTile(null);
              props.onEntityClicked?.(entity);
            }}
          >
            <div className={styles.type}>{entityTypeString(entity.type)}</div>
            <span>{entity.name}</span>
          </button>
        ))}
      </div>
    );
    mapEntities.push(
      new OverlayEntity(selectedTile.x, selectedTile.y, 'menu', entityMenu),
    );
  }

  // The y coordinate goes from bottom to top, but we have to render from top to
  // bottom.
  tiles.reverse();

  return (
    <div
      className={styles.map}
      style={{ width: widthPx }}
      onClick={() => setSelectedTile(null)}
    >
      {tiles.map((row, i) => (
        <div key={i} className={styles.mapRow}>
          {row.map((tile) => (
            <Tile key={tile.x} size={props.tileSize} tile={tile} />
          ))}
        </div>
      ))}
      {mapEntities.map((entity) => (
        <MapEntity
          key={entity.getUniqueId()}
          baseX={props.x}
          baseY={props.y}
          entity={entity}
          onSelect={selectedTile === null ? props.onEntityClicked : undefined}
          tileSize={props.tileSize}
        />
      ))}
    </div>
  );
}
