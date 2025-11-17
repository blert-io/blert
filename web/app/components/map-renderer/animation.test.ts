import { Coords } from '@blert/common';
import {
  createInterpolationState,
  osrsToThreePosition,
  updateInterpolation,
} from './animation';
import { PlayerEntity, ReplayConfig } from './types';

let mockTime = 0;

describe('Animation System', () => {
  const createTestPlayer = (
    x: number,
    y: number,
    nextX?: number,
    nextY?: number,
  ): PlayerEntity => {
    let nextPosition: Coords | undefined;
    if (nextX !== undefined && nextY !== undefined) {
      nextPosition = { x: nextX, y: nextY };
    }
    return new PlayerEntity({ x, y }, 'TestPlayer', 0, undefined, nextPosition);
  };

  const createTestConfig = (
    overrides?: Partial<ReplayConfig>,
  ): ReplayConfig => ({
    interpolationEnabled: true,
    tickDuration: 600,
    debug: false,
    ...overrides,
  });

  beforeEach(() => {
    mockTime = 0;
  });

  describe('createInterpolationState', () => {
    it('should create initial state for stationary entity', () => {
      const player = createTestPlayer(5, 5);
      const config = createTestConfig();

      const state = createInterpolationState(player, config, mockTime);

      expect(state.waypoints).toEqual([{ x: 5, y: 5 }]);
      expect(state.startTime).toBe(mockTime);
      expect(state.tickDuration).toBe(600);
    });

    it('should create state with waypoints for moving entity', () => {
      const player = createTestPlayer(0, 0, 1, 1);
      const config = createTestConfig();

      const state = createInterpolationState(player, config, mockTime);

      expect(state.waypoints).toEqual([
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ]);
      expect(state.startTime).toBe(mockTime);
    });
  });

  describe('updateInterpolation', () => {
    it('should snap to position when not playing', () => {
      const player = createTestPlayer(0, 0, 2, 2);
      const config = createTestConfig();

      const result = updateInterpolation(player, null, config, false, mockTime);

      expect(result.position).toEqual({ x: 0, y: 0 });
    });

    it('should snap to position when interpolation disabled', () => {
      const player = createTestPlayer(0, 0, 2, 2);
      const config = createTestConfig({ interpolationEnabled: false });

      const result = updateInterpolation(player, null, config, true, mockTime);

      expect(result.position).toEqual({ x: 0, y: 0 });
    });

    it('should interpolate position during movement', () => {
      const player = createTestPlayer(0, 0, 2, 0);
      const config = createTestConfig();

      const initialResult = updateInterpolation(
        player,
        null,
        config,
        true,
        mockTime,
      );
      expect(initialResult.position).toEqual({ x: 0, y: 0 });

      mockTime = 300;
      const midResult = updateInterpolation(
        player,
        initialResult.interpolationState,
        config,
        true,
        mockTime,
      );
      expect(midResult.position).toEqual({ x: 1, y: 0 });

      mockTime = 600;
      const endResult = updateInterpolation(
        player,
        midResult.interpolationState,
        config,
        true,
        mockTime,
      );
      expect(endResult.position).toEqual({ x: 2, y: 0 });
    });

    it('should handle complex multi-waypoint movement', () => {
      const player = createTestPlayer(0, 0, 2, 2);
      const config = createTestConfig();

      const initialResult = updateInterpolation(
        player,
        null,
        config,
        true,
        mockTime,
      );

      mockTime = 300;
      const midResult = updateInterpolation(
        player,
        initialResult.interpolationState,
        config,
        true,
        mockTime,
      );
      expect(midResult.position).toEqual({ x: 1, y: 1 });

      mockTime = 600;
      const endResult = updateInterpolation(
        player,
        midResult.interpolationState,
        config,
        true,
        mockTime,
      );
      expect(endResult.position).toEqual({ x: 2, y: 2 });
    });
  });

  describe('osrsToThreePosition', () => {
    it('should convert OSRS coordinates to Three.js position', () => {
      const coords: Coords = { x: 5, y: 10 };
      const result = osrsToThreePosition(coords, 0.5);

      expect(result).toEqual([5.5, 0.5, -10.5]);
    });

    it('should use default y offset when not provided', () => {
      const coords: Coords = { x: 3, y: 7 };
      const result = osrsToThreePosition(coords);

      expect(result).toEqual([3.5, 0.5, -7.5]);
    });
  });
});
