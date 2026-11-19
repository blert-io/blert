import { Coords } from '@blert/common';
import { useTexture, Text, Billboard, Line } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useRef, Suspense } from 'react';
import * as THREE from 'three';

import {
  cellAt,
  CustomEntity,
  CYCLES_PER_TICK,
  osrsToThreePosition,
  type ProjectileDefinition,
  replayCycle,
  SheetSprite,
  showCell,
  SpriteFrame,
  spriteFrames,
  SpriteSheet,
  useReplayContext,
  useSheetTexture,
} from '@/components/map-renderer';
import { hash } from '@/utils/math';

export enum ExhumedState {
  RISING,
  ACTIVE,
  RECEDING,
}

export type ExhumedData = {
  position: Coords;
  state: ExhumedState;
  healCount: number;
};

export type DangerQuadrantData = {
  from: Coords;
  to: Coords;
};

export type AcidSplashData = {
  position: Coords;
  tick: number;
};

export type AcidPoolData = {
  position: Coords;
  formTick: number;
  despawnTick: number | null;
  quarterTurns: number;
};

const POISON_COLOR = '#c7e917';
const DANGER_COLOR = '#ef4444';
const DANGER_QUADRANT_HEIGHT = 0.0005;

export const ACID_BALL_FROM_XARPUS: ProjectileDefinition = {
  modelUrl: '/models/xarpus-acid-ball.glb',
  startHeight: 400,
  endHeight: 0,
  slope: 16,
  startDistance: 32,
};

export const ACID_BALL_FROM_BOUNCE: ProjectileDefinition = {
  modelUrl: '/models/xarpus-acid-ball.glb',
  startHeight: 0,
  endHeight: 0,
  slope: 45,
  startDistance: 32,
};

export const POISON_BALL: ProjectileDefinition = {
  modelUrl: '/models/xarpus-poison-ball.glb',
  startHeight: 0,
  endHeight: 270,
  slope: 50,
  startDistance: 0,
};

export const ACID_POOL: SpriteSheet = {
  url: '/images/objects/xarpus-acid-pool.webp',
  columns: 5,
  rows: 2,
  cellWidth: 1.0469,
  cellHeight: 1.0391,
  anchorX: 0.4925,
  anchorY: 0.5038,
};

export const ACID_SPLASH: SpriteSheet = {
  url: '/images/objects/xarpus-acid-splash.webp',
  columns: 5,
  rows: 2,
  cellWidth: 2.0547,
  cellHeight: 1.9375,
  anchorX: 0.4753,
  anchorY: 0.5565,
};

const ACID_POOL_FORM_FRAMES = spriteFrames(0, 5, 3);
const ACID_POOL_FORMED_CELL = 5;
const ACID_POOL_END_FRAMES = spriteFrames(6, 3, 4);
const ACID_POOL_HEIGHT = 0.001;
const ACID_SPLASH_FRAMES: SpriteFrame[] = [10, 2, 2, 2, 3, 3, 3, 2, 2, 2].map(
  (cycles, cell) => ({ cell, cycles }),
);

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

export class ExhumedEntity extends CustomEntity<ExhumedData> {
  constructor(position: Coords, state: ExhumedState, healCount: number) {
    super(
      'Exhumed',
      1,
      ExhumedRenderer,
      { position, state, healCount },
      `exhumed-${position.x}-${position.y}`,
    );
  }
}

export class DangerQuadrantEntity extends CustomEntity<DangerQuadrantData> {
  constructor(center: Coords, corner: Coords) {
    super(
      'Danger Quadrant',
      1,
      DangerQuadrantRenderer,
      {
        from: { x: center.x + 0.5, y: center.y + 0.5 },
        to: {
          x: corner.x + 0.5 + Math.sign(corner.x - center.x) / 2,
          y: corner.y + 0.5 + Math.sign(corner.y - center.y) / 2,
        },
      },
      'danger-quadrant',
    );
  }
}

export class AcidSplashEntity extends CustomEntity<AcidSplashData> {
  constructor(position: Coords, tick: number, uniqueId: string) {
    super('Acid Splash', 1, AcidSplashRenderer, { position, tick }, uniqueId);
  }
}

export class AcidPoolEntity extends CustomEntity<AcidPoolData> {
  constructor(position: Coords, formTick: number, despawnTick: number | null) {
    super(
      'Acid Pool',
      1,
      AcidPoolRenderer,
      {
        position,
        formTick,
        despawnTick,
        quarterTurns: Math.floor(
          hash(position.x * 78.233 + position.y * 37.719) * 4,
        ),
      },
      `acid-pool-${position.x}-${position.y}`,
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

  const position = osrsToThreePosition(entity.data.position, 0.01);

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

function DangerQuadrantRenderer({
  entity,
}: {
  entity: CustomEntity<DangerQuadrantData>;
}) {
  const { from, to } = entity.data;
  const outline: [number, number, number][] = [
    [from.x, DANGER_QUADRANT_HEIGHT, -from.y],
    [to.x, DANGER_QUADRANT_HEIGHT, -from.y],
    [to.x, DANGER_QUADRANT_HEIGHT, -to.y],
    [from.x, DANGER_QUADRANT_HEIGHT, -to.y],
    [from.x, DANGER_QUADRANT_HEIGHT, -from.y],
  ];

  return (
    <group>
      <mesh
        position={[
          (from.x + to.x) / 2,
          DANGER_QUADRANT_HEIGHT,
          -(from.y + to.y) / 2,
        ]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <planeGeometry
          args={[Math.abs(to.x - from.x), Math.abs(to.y - from.y)]}
        />
        <meshBasicMaterial
          color={DANGER_COLOR}
          transparent
          opacity={0.11}
          depthWrite={false}
        />
      </mesh>
      <Line
        points={outline}
        color={DANGER_COLOR}
        lineWidth={2}
        transparent
        opacity={0.34}
        depthWrite={false}
      />
    </group>
  );
}

function AcidSplashRenderer({
  entity,
}: {
  entity: CustomEntity<AcidSplashData>;
}) {
  return (
    <Billboard position={osrsToThreePosition(entity.data.position, 0)}>
      <Suspense fallback={null}>
        <AcidSplash data={entity.data} />
      </Suspense>
    </Billboard>
  );
}

function AcidSplash({ data }: { data: AcidSplashData }) {
  const replay = useReplayContext();
  const texture = useSheetTexture(ACID_SPLASH);
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame(() => {
    const mesh = meshRef.current;
    if (mesh === null) {
      return;
    }

    const cell = cellAt(
      ACID_SPLASH_FRAMES,
      replayCycle(replay) - data.tick * CYCLES_PER_TICK,
    );
    mesh.visible = cell !== undefined;
    if (cell !== undefined) {
      showCell(texture, ACID_SPLASH, cell);
    }
  });

  return (
    <SheetSprite
      ref={meshRef}
      sheet={ACID_SPLASH}
      texture={texture}
      visible={false}
    />
  );
}

function AcidPoolRenderer({ entity }: { entity: CustomEntity<AcidPoolData> }) {
  return (
    <group
      position={osrsToThreePosition(entity.data.position, ACID_POOL_HEIGHT)}
      rotation={[-Math.PI / 2, 0, (entity.data.quarterTurns * Math.PI) / 2]}
    >
      <Suspense fallback={null}>
        <AcidPool data={entity.data} />
      </Suspense>
    </group>
  );
}

function AcidPool({ data }: { data: AcidPoolData }) {
  const replay = useReplayContext();
  const texture = useSheetTexture(ACID_POOL);
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame(() => {
    const mesh = meshRef.current;
    if (mesh === null) {
      return;
    }

    const { formTick, despawnTick } = data;
    const cycle = replayCycle(replay);
    const cell =
      despawnTick !== null && cycle >= despawnTick * CYCLES_PER_TICK
        ? cellAt(ACID_POOL_END_FRAMES, cycle - despawnTick * CYCLES_PER_TICK)
        : (cellAt(ACID_POOL_FORM_FRAMES, cycle - formTick * CYCLES_PER_TICK) ??
          ACID_POOL_FORMED_CELL);
    mesh.visible = cell !== undefined;
    if (cell !== undefined) {
      showCell(texture, ACID_POOL, cell);
    }
  });

  return (
    <SheetSprite
      ref={meshRef}
      sheet={ACID_POOL}
      texture={texture}
      visible={false}
    />
  );
}
