import { Entity } from './entity';

type Tile = {
  x: number;
  y: number;
  color?: string;
  entities: Entity[];
};

type TileProps = {
  tile: Tile;
  size: number;
};

function Tile(props: TileProps) {
  let children = [];

  for (const entity of props.tile.entities) {
    children.push(
      <div
        style={{
          height: props.size * entity.size,
          width: props.size * entity.size,
          position: 'absolute',
          border: '1px solid #979695',
          boxSizing: 'border-box',
          bottom: 0, // An entity's position corresponds to its southwest tile.
          zIndex: 10,
        }}
      >
        {entity.renderContents()}
      </div>,
    );
  }

  return (
    <div
      className="blert-map-tile"
      data-x={props.tile.x}
      data-y={props.tile.y}
      style={{
        backgroundColor: props.tile.color,
        display: 'inline-block',
        position: 'relative',
        height: props.size,
        width: props.size,
      }}
    >
      {...children}
    </div>
  );
}

type MapProps = {
  x: number;
  y: number;
  width: number;
  height: number;
  baseTiles?: any;
  tileSize: number;
  entities: Entity[];
};

export default function Map(props: MapProps) {
  let tiles: Tile[][] = [];
  for (let y = props.y; y < props.y + props.height; y++) {
    let row: Tile[] = [];
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

  if (props.baseTiles) {
    for (const baseTile of props.baseTiles) {
      let tile = getTileForCoords(baseTile.x, baseTile.y);
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
  }

  for (const entity of props.entities) {
    let tile = getTileForCoords(entity.x, entity.y);
    if (tile !== null) {
      tile.entities.push(entity);
    }
  }

  // The y coordinate goes from bottom to top, but we have to render from top to
  // bottom.
  tiles.reverse();

  return (
    <div
      className="blert-map"
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        border: '2px solid #ccc',
      }}
    >
      {tiles.map((row, i) => (
        <div key={i} className="blert-map-row" style={{ display: 'flex' }}>
          {row.map((tile) => (
            <Tile key={tile.x} size={props.tileSize} tile={tile} />
          ))}
        </div>
      ))}
    </div>
  );
}
