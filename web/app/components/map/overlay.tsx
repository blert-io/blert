import React from 'react';
import { Entity, EntityType } from './entity';

export class OverlayEntity implements Entity {
  x: number;
  y: number;
  type: EntityType = EntityType.OVERLAY;
  size: number;
  outlineColor: string | null = null;
  interactable: boolean;
  customZIndex: number | null;

  name: string;
  contents: React.ReactNode;

  constructor(
    x: number,
    y: number,
    name: string,
    contents: React.ReactNode,
    interactable: boolean = true,
    size: number = 1,
    customZIndex: number | null = null,
  ) {
    this.x = x;
    this.y = y;
    this.name = name;
    this.size = size;
    this.contents = contents;
    this.interactable = interactable;
    this.customZIndex = customZIndex;
  }

  getUniqueId(): string {
    return `${this.type}-${this.x},${this.y}-${this.name}`;
  }

  renderContents(): React.ReactNode {
    return this.contents;
  }
}
