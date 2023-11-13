import { Entity, EntityType } from './entity';

/**
 * Entity which highlights a specified tile on the map.
 */
export class MarkerEntity implements Entity {
  x: number;
  y: number;
  type: EntityType = EntityType.HIGHLIGHT;
  size: number = 1;
  outlineColor: string = '#626262';
  interactable: boolean = false;

  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }

  getUniqueId(): string {
    return `${this.type}-${this.x},${this.y}`;
  }

  renderContents(): React.ReactNode {
    return null;
  }
}
