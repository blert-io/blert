import { useTexture } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';

import {
  CustomEntity,
  osrsToThreePosition,
  useReplayContext,
} from '@/components/map-renderer';

export enum BloatHandState {
  FALLING,
  SPLAT,
}

export type BloatHandData = {
  state: BloatHandState;
  dropProgress: number;
  dropTicks: number;
};

// Progress within the falling animation when the hand starts dropping.
const DROP_START_PROGRESS = 0.9;
const INITIAL_HAND_HEIGHT = 10;

function easeInQuad(x: number): number {
  return x * x;
}

export default function BloatHandRenderer({
  entity,
}: {
  entity: CustomEntity<BloatHandData>;
}) {
  const { config, playing } = useReplayContext();

  const { state, dropProgress, dropTicks } = entity.data;
  const droppingStateRef = useRef<{ startTime: number } | null>(null);

  const shadowTexture = useTexture('/images/objects/bloat_hand_drop.png');
  const handTexture = useTexture('/images/objects/bloat_hand_splat.png');

  const groupRef = useRef<THREE.Group>(null);
  const shadowRef = useRef<THREE.Mesh>(null);
  const handRef = useRef<THREE.Mesh>(null);

  useEffect(() => {
    droppingStateRef.current = null;
  }, [entity]);

  useFrame(({ clock }) => {
    if (!groupRef.current || !shadowRef.current || !handRef.current) {
      return;
    }

    const shouldInterpolate = config.interpolationEnabled && playing;
    const currentTime = clock.getElapsedTime() * 1000;

    const dropState = droppingStateRef.current ?? {
      startTime: currentTime,
    };
    droppingStateRef.current = dropState;

    const elapsed = currentTime - dropState.startTime;

    if (state === BloatHandState.FALLING) {
      // Grow the size of the shadow as the hand falls.
      shadowRef.current.visible = true;

      const tickProgress = shouldInterpolate
        ? Math.min(elapsed / config.tickDuration, 1)
        : 0;
      const progress = Math.min(dropProgress + tickProgress / dropTicks, 1);

      const shadowSize = 0.2 + progress * 0.8;
      shadowRef.current.scale.set(shadowSize, shadowSize, 1);
      (shadowRef.current.material as THREE.MeshBasicMaterial).opacity =
        0.45 + progress * 0.45;

      if (shouldInterpolate && progress > DROP_START_PROGRESS) {
        const dropAnimationProgress =
          (progress - DROP_START_PROGRESS) / (1 - DROP_START_PROGRESS);
        handRef.current.visible = true;
        handRef.current.position.y =
          INITIAL_HAND_HEIGHT -
          INITIAL_HAND_HEIGHT * easeInQuad(dropAnimationProgress);
      } else {
        handRef.current.visible = false;
        handRef.current.position.y = INITIAL_HAND_HEIGHT;
      }
    } else {
      // Splat.
      shadowRef.current.visible = false;
      handRef.current.visible = true;
      handRef.current.position.y = 0;

      if (shouldInterpolate) {
        const fadeProgress = Math.min(elapsed / config.tickDuration, 1);
        (handRef.current.material as THREE.MeshBasicMaterial).opacity =
          1 - fadeProgress;
      } else {
        (handRef.current.material as THREE.MeshBasicMaterial).opacity = 1;
      }
    }
  });

  const position = osrsToThreePosition(entity.position, 0.02);

  return (
    <group ref={groupRef} position={position}>
      <mesh ref={shadowRef} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial map={shadowTexture} transparent />
      </mesh>
      <mesh ref={handRef} visible={false} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial map={handTexture} transparent />
      </mesh>
    </group>
  );
}
