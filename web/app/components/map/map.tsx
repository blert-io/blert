import { useState, useMemo, useCallback } from 'react';

import { Entity, MapEntity, entityTypeString } from './entity';
import { OverlayEntity } from './overlay';
import Tile, { TileData } from './tile';

import styles from './style.module.scss';

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
  faceSouth?: boolean;
};

const MAP_BORDER_PX = 2;

export default function Map({
  x,
  y,
  width,
  height,
  baseTiles = [],
  tileSize,
  entities,
  onEntityClicked,
  faceSouth = false,
}: MapProps) {
  const [selectedTile, setSelectedTile] = useState<TileData | null>(null);
  const widthPx = tileSize * width + 2 * MAP_BORDER_PX;

  const getTileForCoords = useCallback(
    (tx: number, ty: number, tiles: TileData[][]) => {
      if (tx < x || tx >= x + width || ty < y || ty >= y + height) {
        return null;
      }

      const relX = tx - x;
      const relY = ty - y;
      return tiles[relY][relX];
    },
    [x, y, width, height],
  );

  const [tiles, mapEntities] = useMemo(() => {
    const tiles: TileData[][] = [];
    for (let yy = y; yy < y + height; yy++) {
      const row: TileData[] = [];
      for (let xx = x; xx < x + width; xx++) {
        row.push({ x: xx, y: yy, entities: [] });
      }
      tiles.push(row);
    }

    for (const baseTile of baseTiles) {
      const tile = getTileForCoords(baseTile.x, baseTile.y, tiles);
      if (tile === null) {
        console.error(
          `base tile (${baseTile.x},${baseTile.y}) is out-of-bounds`,
        );
        continue;
      }

      if (baseTile.color) {
        tile.color = baseTile.color;
      }
    }

    const mapEntities: Entity[] = [];
    const packedTiles: TileData[] = [];

    for (const entity of entities) {
      const tile = getTileForCoords(entity.x, entity.y, tiles);
      if (tile !== null) {
        mapEntities.push(entity);

        if (!entity.interactable) {
          continue;
        }

        if (tile.entities.length === 1) {
          packedTiles.push(tile);
        }
        tile.entities.push(entity);
      }
    }

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
      const offset = tileSize / 2;
      const xPosition =
        selectedTile.x - x > width / 2 ? { right: offset } : { left: offset };
      const yPosition =
        selectedTile.y - y > height / 2 ? { top: offset } : { bottom: offset };
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
                onEntityClicked?.(entity);
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

    if (faceSouth) {
      for (const row of tiles) {
        row.reverse();
      }
    } else {
      // The y coordinate goes from bottom to top, but we have to render from
      // top to bottom.
      tiles.reverse();
    }

    return [tiles, mapEntities];
  }, [
    baseTiles,
    entities,
    tileSize,
    width,
    height,
    x,
    y,
    faceSouth,
    selectedTile,
    onEntityClicked,
    getTileForCoords,
  ]);

  return (
    <div
      className={styles.map}
      style={{ width: widthPx }}
      onClick={() => setSelectedTile(null)}
    >
      {tiles.map((row) => (
        <div key={row[0].y} className={styles.mapRow} data-row-y={row[0].y}>
          {row.map((tile) => (
            <Tile key={tile.x} size={tileSize} tile={tile} />
          ))}
        </div>
      ))}
      {mapEntities.map((entity) => (
        <MapEntity
          key={entity.getUniqueId()}
          baseX={x}
          baseY={y}
          entity={entity}
          onSelect={selectedTile === null ? onEntityClicked : undefined}
          faceSouth={faceSouth}
          tileSize={tileSize}
        />
      ))}
    </div>
  );
}
