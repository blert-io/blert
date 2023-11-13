import { Entity, MapEntity } from './entity';
import Tile, { TileData } from './tile';

import styles from './style.module.css';
import { OverlayEntity } from './overlay';

type BaseTile = {
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
};

export default function Map(props: MapProps) {
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
    const entityCount = (
      <div className={styles.countOverlay}>
        <div className={styles.count}>{tile.entities.length}</div>
      </div>
    );
    mapEntities.push(new OverlayEntity(tile.x, tile.y, entityCount));
  });

  // The y coordinate goes from bottom to top, but we have to render from top to
  // bottom.
  tiles.reverse();

  return (
    <div className={styles.map}>
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
          tileSize={props.tileSize}
        />
      ))}
    </div>
  );
}
