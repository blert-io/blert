import React from 'react';
import { Entity, EntityType } from './entity';

export class OverlayEntity implements Entity {
  x: number;
  y: number;
  type: EntityType = EntityType.OVERLAY;
  size: number = 1;
  outlineColor: string | null = null;
  interactable: boolean = true;

  name: string;
  contents: React.ReactNode;

  constructor(x: number, y: number, name: string, contents: React.ReactNode) {
    this.x = x;
    this.y = y;
    this.name = name;
    this.contents = contents;
  }

  getUniqueId(): string {
    return `${this.type}-${this.x},${this.y}-${this.name}`;
  }

  renderContents(): React.ReactNode {
    return this.contents;
  }
}
