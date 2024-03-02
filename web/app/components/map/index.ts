import Map, { BaseTile } from './map';

export type { Entity } from './entity';
export { EntityType } from './entity';
export { MarkerEntity } from './marker';
export { NpcEntity } from './npc';
export { PlayerEntity } from './player';

export type MapDefinition = {
  baseX: number;
  baseY: number;
  width: number;
  height: number;
  faceSouth?: boolean;
  baseTiles: BaseTile[];
};

export default Map;
