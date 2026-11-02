import { Coords } from '@blert/common';

export interface Terrain {
  isPassable(coords: Coords): boolean;
}

/**
 * Creates a terrain from an ASCII map grid, where each string is one row of
 * tiles. Rows run from north to south, so the first character of the last row
 * is the tile at `origin`. A `#` or a space is impassable, and so is any tile
 * outside the grid.
 *
 * Passable tiles are represented by `.` or a hex digit of movement flags,
 * as follows:
 *
 * - Bit 1: North wall
 * - Bit 2: East wall
 * - Bit 3: South wall
 * - Bit 4: West wall
 *
 * `.` represents a tile without walls, equivalent to `0`, for readability.
 *
 * The path renderer currently ignores movement flags and treats each
 * non-blocked tile as fully passable.
 */
export class GridTerrain implements Terrain {
  constructor(
    private readonly origin: Coords,
    private readonly rows: string[],
  ) {}

  isPassable(coords: Coords): boolean {
    const row = this.rows[this.rows.length - 1 - (coords.y - this.origin.y)];
    const tile = row?.[coords.x - this.origin.x];
    return tile !== undefined && tile !== '#' && tile !== ' ';
  }
}

/**
 * Returns the visual path moved by an OSRS player in a single tick.
 *
 * This is not a pathfinding algorithm. `from` and `to` must be known player
 * positions exactly a tick apart.
 *
 * @param from Player position on the first tick.
 * @param to Player position on the second tick.
 * @param terrain Optional terrain to check for passability in the case of
 * single tile diagonal movement.
 * @returns The visual path moved by the player in a single tick, or null if the
 * movement must have been a teleport.
 */
export function visualPath(
  from: Coords,
  to: Coords,
  terrain?: Terrain,
  allowTeleport: boolean = false,
): Coords[] | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;

  if (dx === 0 && dy === 0) {
    // No movement.
    return [from];
  }

  if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
    // Players can only move 2 tiles per tick. Anything longer is considered a
    // teleport, which should not be interpolated.
    return allowTeleport ? [from, to] : null;
  }

  if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) {
    if (dx !== 0 && dy !== 0 && terrain !== undefined) {
      // This is a diagonal move. Check for obstacles that would block direct
      // diagonal movement and must be passed around.
      const cornerX = { x: from.x + dx, y: from.y };
      const cornerY = { x: from.x, y: from.y + dy };

      if (!terrain.isPassable(cornerX)) {
        return [from, cornerY, to];
      }
      if (!terrain.isPassable(cornerY)) {
        return [from, cornerX, to];
      }
      // The case where neither corner is passable is not considered as it
      // violates the function's precondition.
    }
    return [from, to];
  }

  // For moves > 1 tile, the player moves along the dominant axis first.
  // If the move is L-shaped (i.e. dx != dy), check if the later diagonal would
  // be blocked by an obstacle. If so, the diagonal must happen first.
  const intermediate = { x: from.x, y: from.y };
  if (Math.abs(dx) > Math.abs(dy)) {
    intermediate.x += Math.sign(dx);
    if (terrain !== undefined && dy !== 0) {
      const corner = { x: from.x + dx, y: from.y };
      if (!terrain.isPassable(corner)) {
        intermediate.y += Math.sign(dy);
      }
    }
  } else if (Math.abs(dy) > Math.abs(dx)) {
    intermediate.y += Math.sign(dy);
    if (terrain !== undefined && dx !== 0) {
      const corner = { x: from.x, y: from.y + dy };
      if (!terrain.isPassable(corner)) {
        intermediate.x += Math.sign(dx);
      }
    }
  } else {
    // Diagonal move.
    intermediate.x += Math.sign(dx);
    intermediate.y += Math.sign(dy);
  }

  return [from, intermediate, to];
}
