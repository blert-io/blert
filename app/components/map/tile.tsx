import { Entity } from './entity';
import styles from './style.module.css';

export type TileData = {
  x: number;
  y: number;
  color?: string;
  entities: Entity[];
};

type TileProps = {
  tile: TileData;
  size: number;
};

export default function Tile(props: TileProps) {
  return (
    <div
      className={styles.mapTile}
      data-x={props.tile.x}
      data-y={props.tile.y}
      style={{
        backgroundColor: props.tile.color,
        height: props.size,
        width: props.size,
      }}
    />
  );
}
