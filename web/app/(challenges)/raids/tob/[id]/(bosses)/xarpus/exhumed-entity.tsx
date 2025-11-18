import { Coords } from '@blert/common';
import { useTexture, Text, Billboard } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useRef, Suspense } from 'react';
import * as THREE from 'three';

import {
  CustomEntity,
  osrsToThreePosition,
  useReplayContext,
} from '@/components/map-renderer';

export enum ExhumedState {
  RISING,
  ACTIVE,
  RECEDING,
}

export type ExhumedData = {
  state: ExhumedState;
  healCount: number;
};

export type PoisonBallData = {
  from: Coords;
  to: Coords;
};

const POISON_COLOR = '#c7e917';

type TextLabelApi = {
  fillOpacity: number;
  outlineOpacity: number;
};

function easeOutQuad(x: number): number {
  return 1 - (1 - x) * (1 - x);
}

function easeInQuad(x: number): number {
  return x * x;
}

function getParabolicPosition(
  from: Coords,
  to: Coords,
  progress: number,
  height: number = 3,
): THREE.Vector3 {
  const x = from.x + (to.x - from.x) * progress;
  const z = from.y + (to.y - from.y) * progress;
  const y = height * Math.sin(Math.PI * progress);
  return new THREE.Vector3(x, y, -z);
}

export class ExhumedEntity extends CustomEntity<ExhumedData> {
  constructor(position: Coords, state: ExhumedState, healCount: number) {
    super(
      position,
      'Exhumed',
      1,
      ExhumedRenderer,
      { state, healCount },
      `exhumed-${position.x}-${position.y}`,
    );
  }
}

export class PoisonBallEntity extends CustomEntity<PoisonBallData> {
  constructor(from: Coords, to: Coords) {
    super(
      from,
      'Poison Ball',
      1,
      PoisonBallRenderer,
      {
        from: { x: from.x + 0.5, y: from.y + 0.5 },
        to: { x: to.x + 0.5, y: to.y + 0.5 },
      },
      `poison-ball-${from.x}-${from.y}-${Date.now()}`,
    );
  }
}

function ExhumedFallback() {
  const matRef = useRef<THREE.MeshBasicMaterial>(null);

  useFrame(({ clock }) => {
    if (matRef.current) {
      const pulse = 0.45 + 0.1 * Math.sin(clock.getElapsedTime() * 2.0);
      matRef.current.opacity = pulse;
    }
  });

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial
        ref={matRef}
        color="#5865f2"
        transparent
        opacity={0.5}
      />
    </mesh>
  );
}

function ExhumedSprite() {
  const exhumedTexture = useTexture('/images/objects/exhumed.png');

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial map={exhumedTexture} transparent />
    </mesh>
  );
}

function ExhumedRenderer({ entity }: { entity: CustomEntity<ExhumedData> }) {
  const { config, playing } = useReplayContext();

  const groupRef = useRef<THREE.Group>(null);
  const exhumedRef = useRef<THREE.Mesh>(null);
  const animationStateRef = useRef<{ startTime: number } | null>(null);
  const healCountOpacity = useRef(1);
  const healCountMaterialsRef = useRef<THREE.MeshBasicMaterial[]>([]);
  const textRef = useRef<TextLabelApi | null>(null);

  const { state, healCount } = entity.data;

  useEffect(() => {
    animationStateRef.current = null;
  }, [entity]);

  useFrame(({ clock }) => {
    if (!groupRef.current || !exhumedRef.current) {
      return;
    }

    const shouldInterpolate = config.interpolationEnabled && playing;
    const currentTime = clock.getElapsedTime() * 1000;

    animationStateRef.current ??= {
      startTime: currentTime,
    };

    const elapsed = currentTime - animationStateRef.current.startTime;

    switch (state) {
      case ExhumedState.RISING:
        if (shouldInterpolate) {
          const progress = Math.min(elapsed / config.tickDuration, 1);
          const easeProgress = easeOutQuad(progress);
          exhumedRef.current.position.y = -0.5 + easeProgress * 0.5;
          exhumedRef.current.visible = true;
        } else {
          exhumedRef.current.position.y = 0;
          exhumedRef.current.visible = true;
        }
        healCountOpacity.current = 1;
        break;

      case ExhumedState.ACTIVE:
        exhumedRef.current.position.y = 0;
        exhumedRef.current.visible = true;
        healCountOpacity.current = 1;
        break;

      case ExhumedState.RECEDING:
        if (shouldInterpolate) {
          const progress = Math.min(elapsed / config.tickDuration, 1);
          const easeProgress = easeInQuad(progress);
          exhumedRef.current.position.y = -easeProgress * 0.5;
          exhumedRef.current.visible = progress < 1;
          healCountOpacity.current = 1 - progress;
        } else {
          exhumedRef.current.visible = true;
          healCountOpacity.current = 1;
        }
        break;
    }

    healCountMaterialsRef.current.forEach((material) => {
      if (material) {
        material.opacity = healCountOpacity.current;
      }
    });

    if (textRef.current) {
      textRef.current.fillOpacity = healCountOpacity.current;
      textRef.current.outlineOpacity = healCountOpacity.current;
    }
  });

  const position = osrsToThreePosition(entity.position, 0.01);

  return (
    <group ref={groupRef} position={position}>
      <group ref={exhumedRef}>
        <Suspense fallback={<ExhumedFallback />}>
          <ExhumedSprite />
        </Suspense>
      </group>

      {healCount > 0 && (
        <Billboard position={[0, 0.1, 0]}>
          {healCount < 5 ? (
            Array.from({ length: healCount }).map((_, i) => (
              <mesh
                key={i}
                position={[(i - (healCount - 1) / 2) * 0.15, 0, 0.3]}
              >
                <sphereGeometry args={[0.05, 8, 8]} />
                <meshBasicMaterial
                  ref={(ref) => {
                    if (ref && !healCountMaterialsRef.current.includes(ref)) {
                      healCountMaterialsRef.current.push(ref);
                    }
                  }}
                  color={POISON_COLOR}
                  transparent
                  opacity={1}
                />
              </mesh>
            ))
          ) : (
            <group>
              <mesh position={[0.15, 0, 0.3]}>
                <sphereGeometry args={[0.05, 8, 8]} />
                <meshBasicMaterial
                  ref={(ref) => {
                    if (ref && !healCountMaterialsRef.current.includes(ref)) {
                      healCountMaterialsRef.current.push(ref);
                    }
                  }}
                  color={POISON_COLOR}
                  transparent
                  opacity={1}
                />
              </mesh>
              <Text
                ref={textRef}
                position={[-0.15, 0, 0.3]}
                fontSize={0.2}
                color={POISON_COLOR}
                anchorX="center"
                anchorY="middle"
                font="/fonts/runescape.ttf"
                outlineWidth={0.02}
                outlineColor="#000"
                fillOpacity={1}
                outlineOpacity={1}
              >
                {healCount}×
              </Text>
            </group>
          )}
        </Billboard>
      )}
    </group>
  );
}

function PoisonBallRenderer({
  entity,
}: {
  entity: CustomEntity<PoisonBallData>;
}) {
  const { config, playing } = useReplayContext();
  const meshRef = useRef<THREE.Mesh>(null);
  const startTimeRef = useRef<number | null>(null);

  const { from, to } = entity.data;

  useFrame(({ clock }) => {
    if (!meshRef.current) {
      return;
    }

    const shouldInterpolate = config.interpolationEnabled && playing;
    const currentTime = clock.getElapsedTime() * 1000;

    startTimeRef.current ??= currentTime;

    if (shouldInterpolate) {
      const elapsed = currentTime - startTimeRef.current;
      const progress = Math.min(elapsed / config.tickDuration, 1);

      if (progress >= 1) {
        meshRef.current.visible = false;
        return;
      }

      const position = getParabolicPosition(from, to, progress);
      meshRef.current.position.copy(position);
      meshRef.current.visible = true;
    } else {
      // Without interpolation, hide the ball.
      const position = osrsToThreePosition(from, 0.5);
      meshRef.current.position.set(...position);
      meshRef.current.visible = false;
    }
  });

  return (
    <mesh ref={meshRef}>
      <sphereGeometry args={[0.1, 8, 8]} />
      <meshBasicMaterial color={POISON_COLOR} />
    </mesh>
  );
}
