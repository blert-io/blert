import { Entity, EntityType } from './entity';

/**
 * Entity which highlights a specified tile on the map.
 */
export class MarkerEntity implements Entity {
  x: number;
  y: number;
  type: EntityType = EntityType.HIGHLIGHT;
  size: number;
  name: string;
  outlineColor: string;
  interactable: boolean = false;
  customZIndex: number | null = null;

  private static DEFAULT_OUTLINE_COLOR: string = '#626262';

  constructor(x: number, y: number, color?: string, size: number = 1) {
    this.x = x;
    this.y = y;
    this.size = size;
    this.name = `Tile (${this.x},${this.y})`;
    this.outlineColor = color ?? MarkerEntity.DEFAULT_OUTLINE_COLOR;
  }

  getUniqueId(): string {
    return `${this.type}-${this.x},${this.y}`;
  }

  renderContents(): React.ReactNode {
    return null;
  }
}
