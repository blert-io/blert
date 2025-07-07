'use client';

import { Coords } from '@blert/common';
import { Billboard, Circle, Text } from '@react-three/drei';

import { osrsToThreePosition } from './animation';
import { useReplayContext } from './replay-context';

interface StackIndicatorProps {
  /** The tile coordinates of the stack. */
  position: Coords;
  /** The number of entities in the stack. */
  size: number;
}

/**
 * Renders a simple visual indicator on a tile that contains multiple
 * interactive entities.
 */
export default function StackIndicator({
  position,
  size,
}: StackIndicatorProps) {
  const { playing } = useReplayContext();

  if (playing) {
    return null;
  }

  const threePosition = osrsToThreePosition(position, 2.5);

  return (
    <Billboard position={threePosition}>
      <Circle args={[0.4, 32]}>
        <meshBasicMaterial
          color="#000000"
          transparent
          opacity={0.5}
          depthWrite={false}
        />
      </Circle>
      <Text
        fontSize={0.4}
        color="white"
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.03}
        outlineColor="#000000"
      >
        {size.toString()}
      </Text>
    </Billboard>
  );
}
