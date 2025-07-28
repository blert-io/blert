import { Coords } from '@blert/common';

import { coordsEqual } from '@/utils/coords';

import { Terrain, visualPath } from './path';
import {
  InterpolationState,
  NpcEntity,
  PlayerEntity,
  ReplayConfig,
} from './types';
import { clamp } from '@/utils/math';

export function createInterpolationState(
  entity: PlayerEntity | NpcEntity,
  config: ReplayConfig,
  currentTime: number,
  terrain?: Terrain,
): InterpolationState {
  const from = entity.position;
  const to = entity.nextPosition ?? entity.position;

  // TODO(frolv): Actually handle the entity's movement speed instead of this hack.
  const allowTeleport = entity.maxSpeed > 1;
  const waypoints = visualPath(from, to, terrain, allowTeleport) ?? [from];

  return {
    waypoints,
    startTime: currentTime,
    tickDuration: config.tickDuration,
  };
}

/**
 * Updates interpolation state and returns the current interpolated position.
 *
 * @param entity The entity to update.
 * @param interpolationState The current interpolation state.
 * @param config The interpolation configuration.
 * @param currentTime Clock time.
 * @returns Updated position and interpolation state
 */
export function updateInterpolation(
  entity: PlayerEntity | NpcEntity,
  interpolationState: InterpolationState | null,
  config: ReplayConfig,
  playing: boolean,
  currentTime: number,
  terrain?: Terrain,
): { position: Coords; interpolationState: InterpolationState } {
  const from = entity.position;
  const to = entity.nextPosition || entity.position;

  // Snap to the position if not playing or interpolation is disabled.
  if (!playing || !config.interpolationEnabled) {
    return {
      position: from,
      interpolationState: createInterpolationState(
        entity,
        config,
        currentTime,
        terrain,
      ),
    };
  }

  if (
    !interpolationState ||
    !coordsEqual(interpolationState.waypoints[0], from) ||
    !coordsEqual(
      interpolationState.waypoints[interpolationState.waypoints.length - 1],
      to,
    )
  ) {
    return {
      position: from,
      interpolationState: createInterpolationState(
        entity,
        config,
        currentTime,
        terrain,
      ),
    };
  }

  const elapsed = currentTime - interpolationState.startTime;
  const totalProgress = Math.min(elapsed / interpolationState.tickDuration, 1);

  if (totalProgress >= 1) {
    return {
      position: to,
      interpolationState: {
        ...interpolationState,
      },
    };
  }

  const position = calculatePositionAlongWaypoints(
    interpolationState.waypoints,
    totalProgress,
  );

  return {
    position,
    interpolationState: {
      ...interpolationState,
    },
  };
}

function calculatePositionAlongWaypoints(
  waypoints: Coords[],
  progress: number,
): Coords {
  if (waypoints.length === 0) {
    return { x: 0, y: 0 };
  }

  if (waypoints.length === 1) {
    return waypoints[0];
  }

  const segmentLength = 1 / (waypoints.length - 1);
  const segmentIndex = Math.floor(progress / segmentLength);
  const segmentProgress = (progress % segmentLength) / segmentLength;

  const fromIndex = Math.min(segmentIndex, waypoints.length - 2);
  const toIndex = fromIndex + 1;

  const from = waypoints[fromIndex];
  const to = waypoints[toIndex];

  return {
    x: from.x + (to.x - from.x) * segmentProgress,
    y: from.y + (to.y - from.y) * segmentProgress,
  };
}

const FAN_OUT_BASE_RADIUS = 0.8;
const FAN_OUT_MIN_ARC = Math.PI / 2;
const FAN_OUT_MAX_ARC = Math.PI * (3 / 2);
const FAN_OUT_MAX_ARC_COUNT = 10;

/**
 * Calculates the offset for a fan-out entity.
 *
 * @param index The index of the entity in the stack.
 * @param count The total number of entities in the stack.
 * @param size The size of the entity.
 * @returns The offset for the entity.
 */
export function calculateFanOutOffset(
  index: number,
  count: number,
  size: number = 1,
): Coords {
  if (count <= 1) {
    return { x: 0, y: 0 };
  }

  const progress = clamp((count - 2) / (FAN_OUT_MAX_ARC_COUNT - 2), 0, 1);
  const arc = FAN_OUT_MIN_ARC + (FAN_OUT_MAX_ARC - FAN_OUT_MIN_ARC) * progress;

  const angleStep = arc / (count - 1);
  const initialAngle = -Math.PI / 2 - arc / 2;
  const angle = initialAngle + index * angleStep;

  const sizeOffset = 0.25 * (size - 1);
  const stackSizeOffset = 0.15 * (count - 2); // Min 2 entities in stack.
  const radius = FAN_OUT_BASE_RADIUS + sizeOffset + stackSizeOffset;

  return {
    x: radius * Math.cos(angle),
    y: radius * Math.sin(angle),
  };
}

/**
 * Converts OSRS coordinates to Three.js scene coordinates.
 *
 * @param coords The OSRS coordinates.
 * @param yOffset Vertical offset to apply.
 * @returns The Three.js coordinates.
 */
export function osrsToThreePosition(
  coords: Coords,
  yOffset: number = 0.5,
): [number, number, number] {
  // OSRS coordinates are based on the southwest point of the entity. Center
  // them on the Three.js tile by applying a 0.5 offset.
  return [coords.x + 0.5, yOffset, -(coords.y + 0.5)];
}

/**
 * Converts Three.js coordinates to OSRS coordinates.
 *
 * @param coords The Three.js coordinates.
 * @returns The OSRS coordinates.
 */
export function threeToOsrsPosition(coords: [number, number, number]): Coords {
  return {
    x: coords[0] - 0.5,
    y: -(coords[2] + 0.5),
  };
}
