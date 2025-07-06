import { Coords } from '@blert/common';

type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function coordsEqual(a: Coords, b: Coords): boolean {
  return a.x === b.x && a.y === b.y;
}

export function inRect(coords: Coords, rect: Rect): boolean {
  return (
    coords.x >= rect.x &&
    coords.x < rect.x + rect.width &&
    coords.y >= rect.y &&
    coords.y < rect.y + rect.height
  );
}
