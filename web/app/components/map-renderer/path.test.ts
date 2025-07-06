import { Coords } from '@blert/common';

import { Terrain, visualPath } from '@/components/map-renderer/path';

class MockTerrain implements Terrain {
  private readonly impassableTiles: Set<string>;

  public constructor(impassableCoords: Coords[] = []) {
    this.impassableTiles = new Set(
      impassableCoords.map((coords) => `${coords.x},${coords.y}`),
    );
  }

  public isPassable(coords: Coords): boolean {
    return !this.impassableTiles.has(`${coords.x},${coords.y}`);
  }
}

describe('visualPath', () => {
  test('should return a single-point path for no movement', () => {
    const from = { x: 10, y: 10 };
    const to = { x: 10, y: 10 };
    expect(visualPath(from, to)).toEqual([{ x: 10, y: 10 }]);
  });

  describe('teleportation moves', () => {
    test('should return null for long horizontal moves', () => {
      const from = { x: 10, y: 10 };
      const to = { x: 13, y: 10 };
      expect(visualPath(from, to)).toBeNull();
    });

    test('should return null for long vertical moves', () => {
      const from = { x: 10, y: 10 };
      const to = { x: 10, y: 13 };
      expect(visualPath(from, to)).toBeNull();
    });

    test('should return null for long diagonal moves', () => {
      const from = { x: 10, y: 10 };
      const to = { x: 13, y: 13 };
      expect(visualPath(from, to)).toBeNull();
    });
  });

  describe('1-tile moves (no terrain)', () => {
    test('should return a direct path for a cardinal move (East)', () => {
      const from = { x: 10, y: 10 };
      const to = { x: 11, y: 10 };
      expect(visualPath(from, to)).toEqual([from, to]);
    });

    test('should return a direct path for a diagonal move (North-East)', () => {
      const from = { x: 10, y: 10 };
      const to = { x: 11, y: 11 };
      expect(visualPath(from, to)).toEqual([from, to]);
    });
  });

  describe('2-tile moves', () => {
    test('should handle a 2-tile straight move (East)', () => {
      const from = { x: 10, y: 10 };
      const to = { x: 12, y: 10 };
      const intermediate = { x: 11, y: 10 };
      expect(visualPath(from, to)).toEqual([from, intermediate, to]);
    });

    test('should handle a 2-tile L-shaped move where vertical is dominant', () => {
      const from = { x: 10, y: 10 };
      const to = { x: 11, y: 12 };
      const intermediate = { x: 10, y: 11 };
      expect(visualPath(from, to)).toEqual([from, intermediate, to]);
    });

    test('should handle a 2-tile L-shaped move where horizontal is dominant', () => {
      const from = { x: 10, y: 10 };
      const to = { x: 12, y: 11 };
      const intermediate = { x: 11, y: 10 };
      expect(visualPath(from, to)).toEqual([from, intermediate, to]);
    });

    test('should handle a 2-tile pure diagonal move', () => {
      const from = { x: 10, y: 10 };
      const to = { x: 12, y: 12 };
      const intermediate = { x: 11, y: 11 };
      expect(visualPath(from, to)).toEqual([from, intermediate, to]);
    });
  });

  describe('1-tile diagonal moves (with terrain)', () => {
    const from = { x: 10, y: 10 };
    const to = { x: 11, y: 11 };

    test('should return a direct path when terrain is clear', () => {
      const terrain = new MockTerrain();
      expect(visualPath(from, to, terrain)).toEqual([from, to]);
    });

    test('should create an L-path via X-axis if Y-axis corner is blocked', () => {
      const terrain = new MockTerrain([{ x: 10, y: 11 }]);
      const intermediate = { x: 11, y: 10 };
      expect(visualPath(from, to, terrain)).toEqual([from, intermediate, to]);
    });

    test('should create an L-path via Y-axis if X-axis corner is blocked', () => {
      const terrain = new MockTerrain([{ x: 11, y: 10 }]);
      const intermediate = { x: 10, y: 11 };
      expect(visualPath(from, to, terrain)).toEqual([from, intermediate, to]);
    });
  });
});
