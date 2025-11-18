import { Billboard, useTexture } from '@react-three/drei';
import { AttackStyle, Coords } from '@blert/common';
import { useFrame } from '@react-three/fiber';
import { Suspense, useEffect, useRef } from 'react';
import * as THREE from 'three';

import {
  CustomEntity,
  easeInQuint,
  osrsToThreePosition,
  useEntityPositions,
  useReplayContext,
} from '@/components/map-renderer';
import { clamp } from '@/utils/math';

export type MokhaiotlOrbData = {
  /** The style of the orb. */
  style: AttackStyle;
  /** Entity ID of the player being targeted. */
  targetPlayerId: string;
  /** The total number of ticks the orb will travel for. */
  totalTravelTicks: number;
  /** The current tick in the orb's journey. */
  currentTravelTick: number;
};

export class MokhaiotlOrb extends CustomEntity<MokhaiotlOrbData> {
  constructor(
    sourcePosition: Coords,
    style: AttackStyle,
    targetPlayerId: string,
    totalTravelTicks: number,
    currentTravelTick: number,
    uniqueId: string,
  ) {
    super(
      sourcePosition,
      'Mokhaiotl Orb',
      1,
      MokhaiotlOrbRenderer,
      {
        style,
        targetPlayerId,
        totalTravelTicks,
        currentTravelTick,
      },
      uniqueId,
    );
  }
}

// Maximum height of the orb's parabolic arc, in Three.js units.
const MAX_Y_HEIGHT = 2.0;

function OrbSprite({
  style,
  materialRef,
}: {
  style: AttackStyle;
  materialRef: React.RefObject<THREE.SpriteMaterial>;
}) {
  const textureUrl =
    style === AttackStyle.RANGE
      ? '/images/mokhaiotl/ranged-orb.png'
      : style === AttackStyle.MAGE
        ? '/images/mokhaiotl/magic-orb.png'
        : '/images/mokhaiotl/melee-orb.png';

  const texture = useTexture(textureUrl);

  const maxSize = 0.8;
  const { naturalWidth: w, naturalHeight: h } = texture.image as {
    naturalWidth: number;
    naturalHeight: number;
  };
  const aspect = w / h;
  const scale: [number, number, number] =
    aspect >= 1
      ? [maxSize, maxSize / aspect, 1]
      : [maxSize * aspect, maxSize, 1];

  return (
    <Billboard>
      <sprite scale={scale}>
        <spriteMaterial ref={materialRef} map={texture} transparent />
      </sprite>
    </Billboard>
  );
}

function MokhaiotlOrbRenderer({
  entity,
}: {
  entity: CustomEntity<MokhaiotlOrbData>;
}) {
  const { config, playing } = useReplayContext();
  const { positions: entityPositions } = useEntityPositions();

  const groupRef = useRef<THREE.Group>(null);
  const materialRef = useRef<THREE.SpriteMaterial>(null!);

  const animationStartTimeRef = useRef<number | null>(null);
  const lastTickRef = useRef<number>(-1);
  const animationSegmentRef = useRef({
    start: new THREE.Vector3(),
    end: new THREE.Vector3(),
  });
  const orbPosOsrs = useRef<Coords>({ ...entity.position });

  useEffect(() => {
    animationStartTimeRef.current = null;
  }, [entity.data.currentTravelTick]);

  useFrame(({ clock }) => {
    if (!groupRef.current) {
      return;
    }

    const { targetPlayerId, totalTravelTicks, currentTravelTick } = entity.data;

    const shouldInterpolate = config.interpolationEnabled && playing;
    const currentTime = clock.getElapsedTime() * 1000;

    if (lastTickRef.current !== currentTravelTick) {
      // A new tick has begun. Set up the new animation segment.
      const newStart =
        lastTickRef.current === undefined
          ? // For the very first tick, start at the entity's initial position.
            new THREE.Vector3().fromArray(osrsToThreePosition(entity.position))
          : // For subsequent ticks, start where the last animation segment ended.
            animationSegmentRef.current.end.clone();

      let newEndVector = newStart;
      const realTimePlayerPosition = entityPositions.get(targetPlayerId);
      if (realTimePlayerPosition) {
        const remainingTicks = Math.max(
          1,
          totalTravelTicks - currentTravelTick,
        );

        const dx = realTimePlayerPosition.x - orbPosOsrs.current.x;
        const dy = realTimePlayerPosition.y - orbPosOsrs.current.y;

        const endPosOsrs = {
          x: orbPosOsrs.current.x + dx / remainingTicks,
          y: orbPosOsrs.current.y + dy / remainingTicks,
        };

        orbPosOsrs.current = endPosOsrs;

        newEndVector = new THREE.Vector3().fromArray(
          osrsToThreePosition(endPosOsrs),
        );
      }

      animationSegmentRef.current = {
        start: newStart,
        end: newEndVector,
      };

      lastTickRef.current = currentTravelTick;
    }

    animationStartTimeRef.current ??= currentTime;

    let tickProgress = 0;
    if (shouldInterpolate) {
      const elapsed = currentTime - animationStartTimeRef.current;
      tickProgress = Math.min(elapsed / config.tickDuration, 1);
    } else {
      tickProgress = 1;
    }

    groupRef.current.position.lerpVectors(
      animationSegmentRef.current.start,
      animationSegmentRef.current.end,
      tickProgress,
    );

    // Calculate Y position (parabolic arc) based on overall progress.
    const overallProgress = clamp(
      (currentTravelTick + tickProgress) / totalTravelTicks,
      0,
      1,
    );
    const y = 0.5 + 4 * MAX_Y_HEIGHT * overallProgress * (1 - overallProgress);

    groupRef.current.position.y = y;

    if (!shouldInterpolate) {
      if (materialRef.current) {
        materialRef.current.opacity = 0;
      }
      return;
    }

    const isFinalTick = currentTravelTick === totalTravelTicks;
    const hasFinished = currentTravelTick > totalTravelTicks;
    if (materialRef.current) {
      if (isFinalTick) {
        materialRef.current.opacity = easeInQuint(1 - tickProgress);
      } else if (hasFinished) {
        materialRef.current.opacity = 0;
      } else {
        materialRef.current.opacity = 1;
      }
    }
  });

  // Initial position is set based on entity.position, useFrame will update it.
  const initialPosition = osrsToThreePosition(entity.position);

  return (
    <group ref={groupRef} position={initialPosition}>
      <Suspense fallback={null}>
        <OrbSprite style={entity.data.style} materialRef={materialRef} />
      </Suspense>
    </group>
  );
}
