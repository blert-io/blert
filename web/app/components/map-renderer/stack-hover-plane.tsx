'use client';

import { Plane } from '@react-three/drei';
import { ThreeEvent } from '@react-three/fiber';
import { useMemo } from 'react';

import { calculateFanOutOffset, osrsToThreePosition } from './animation';
import { AnyEntity } from './types';

interface StackHoverPlaneProps {
  /** The entities in the stack. */
  entities: AnyEntity[];
  /** Base tile position of the stack. */
  basePosition: { x: number; y: number };
  /** Callback when mouse leaves the entire stack area. */
  onPointerOut: () => void;
}

export default function StackHoverPlane({
  entities,
  basePosition,
  onPointerOut,
}: StackHoverPlaneProps) {
  const { planeSize, planePosition } = useMemo<{
    planeSize: [number, number];
    planePosition: [number, number, number];
  }>(() => {
    if (entities.length === 0) {
      return { planeSize: [1, 1], planePosition: [0, 0, 0] };
    }

    // Calculate bounding box containing all fanned-out entities.
    let minX = Infinity,
      maxX = -Infinity;
    let minY = Infinity,
      maxY = -Infinity;

    entities.forEach((entity, index) => {
      const offset = calculateFanOutOffset(index, entities.length);
      const sizeOffset = (entity.size - 1) / 2;

      const entityCenter = {
        x: basePosition.x + sizeOffset + offset.x,
        y: basePosition.y + sizeOffset + offset.y,
      };

      const halfSize = entity.size / 2;
      minX = Math.min(minX, entityCenter.x - halfSize);
      maxX = Math.max(maxX, entityCenter.x + halfSize);
      minY = Math.min(minY, entityCenter.y - halfSize);
      maxY = Math.max(maxY, entityCenter.y + halfSize);
    });

    const padding = 0.5;
    minX -= padding;
    maxX += padding;
    minY -= padding;
    maxY += padding;

    const width = maxX - minX;
    const height = maxY - minY;
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    const threePosition = osrsToThreePosition({ x: centerX, y: centerY }, 0.02);

    return {
      planeSize: [width, height],
      planePosition: threePosition,
    };
  }, [entities, basePosition]);

  const handlePointerOut = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    onPointerOut();
  };

  return (
    <Plane
      args={planeSize}
      position={planePosition}
      rotation={[-Math.PI / 2, 0, 0]}
      onPointerOut={handlePointerOut}
      visible={false}
    />
  );
}
