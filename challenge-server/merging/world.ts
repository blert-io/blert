export interface CoordsLike {
  x: number;
  y: number;
}

export interface AreaLike {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function coordsEqual(a: CoordsLike, b: CoordsLike): boolean {
  return a.x === b.x && a.y === b.y;
}

export function inArea(coords: CoordsLike, area: AreaLike): boolean {
  return (
    coords.x >= area.x &&
    coords.x < area.x + area.width &&
    coords.y >= area.y &&
    coords.y < area.y + area.height
  );
}

export function chebyshev(a: CoordsLike, b: CoordsLike): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

export function euclidean(a: CoordsLike, b: CoordsLike): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}
