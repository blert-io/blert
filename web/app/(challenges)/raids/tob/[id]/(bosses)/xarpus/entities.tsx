import { Coords } from '@blert/common';
import { useTexture, Text, Billboard, Line } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useRef, Suspense } from 'react';
import * as THREE from 'three';

import {
  cellAt,
  CustomEntity,
  CYCLES_PER_TICK,
  isInterpolating,
  osrsToThreePosition,
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
  state: ExhumedState;
  healCount: number;
};

export type PoisonBallData = {
  from: Coords;
  to: Coords;
};

export type DangerQuadrantData = {
  from: Coords;
  to: Coords;
};

export type AcidBallData = {
  from: Coords;
  to: Coords;
  fromHeight: number;
  launchTick: number;
  landingTick: number;
  velocity: number;
  acceleration: number;
  peakHeight: number;
};

export type AcidSplashData = {
  tick: number;
};

export type AcidPoolData = {
  formTick: number;
  despawnTick: number | null;
  quarterTurns: number;
};

const POISON_COLOR = '#c7e917';
const DANGER_COLOR = '#ef4444';
const DANGER_QUADRANT_HEIGHT = 0.0005;

export const ACID_BALL: SpriteSheet = {
  url: '/images/objects/xarpus-acid-ball.webp',
  columns: 6,
  rows: 6,
  cellWidth: 0.3906,
  cellHeight: 0.5781,
  anchorX: 0.5,
  anchorY: 0.9459,
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

const ACID_BALL_CYCLES = 5;
const ACID_POOL_FORM_FRAMES = spriteFrames(0, 5, 3);
const ACID_POOL_FORMED_CELL = 5;
const ACID_POOL_END_FRAMES = spriteFrames(6, 3, 4);
const ACID_POOL_HEIGHT = 0.001;
const ACID_SPLASH_FRAMES: SpriteFrame[] = [10, 2, 2, 2, 3, 3, 3, 2, 2, 2].map(
  (cycles, cell) => ({ cell, cycles }),
);

const ACID_SLOPE_PER_CYCLE = 1 / 8;
const ACID_MIN_SLOPE = 4;
const ACID_MAX_SLOPE = 16;

const ACID_SHADOW_HEIGHT = 0.002;
const ACID_SHADOW_RADIUS = 0.32;
const ACID_SHADOW_PEAK_RADIUS = 0.21;
const ACID_SHADOW_OPACITY = 0.43;
const ACID_SHADOW_PEAK_OPACITY = 0.24;

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

export class DangerQuadrantEntity extends CustomEntity<DangerQuadrantData> {
  constructor(center: Coords, corner: Coords) {
    super(
      center,
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

export class AcidBallEntity extends CustomEntity<AcidBallData> {
  constructor(
    from: Coords,
    fromHeight: number,
    to: Coords,
    launchTick: number,
    landingTick: number,
    uniqueId: string,
  ) {
    const flightCycles = (landingTick - launchTick) * CYCLES_PER_TICK;
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    const slope = Math.min(
      Math.max(flightCycles * ACID_SLOPE_PER_CYCLE, ACID_MIN_SLOPE),
      ACID_MAX_SLOPE,
    );
    const velocity =
      (distance / flightCycles) * Math.tan((slope * 2 * Math.PI) / 256);
    const acceleration =
      (-2 * (fromHeight + velocity * flightCycles)) / flightCycles ** 2;
    super(
      from,
      'Acid Ball',
      1,
      AcidBallRenderer,
      {
        from: { x: from.x + 0.5, y: from.y + 0.5 },
        to: { x: to.x + 0.5, y: to.y + 0.5 },
        fromHeight,
        launchTick,
        landingTick,
        velocity,
        acceleration,
        peakHeight: fromHeight - (velocity * velocity) / (2 * acceleration),
      },
      uniqueId,
    );
  }
}

export class AcidSplashEntity extends CustomEntity<AcidSplashData> {
  constructor(position: Coords, tick: number, uniqueId: string) {
    super(position, 'Acid Splash', 1, AcidSplashRenderer, { tick }, uniqueId);
  }
}

export class AcidPoolEntity extends CustomEntity<AcidPoolData> {
  constructor(position: Coords, formTick: number, despawnTick: number | null) {
    super(
      position,
      'Acid Pool',
      1,
      AcidPoolRenderer,
      {
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

function AcidBallRenderer({ entity }: { entity: CustomEntity<AcidBallData> }) {
  return (
    <Suspense fallback={null}>
      <AcidBall data={entity.data} />
    </Suspense>
  );
}

function AcidBall({ data }: { data: AcidBallData }) {
  const replay = useReplayContext();
  const texture = useSheetTexture(ACID_BALL);

  const ballRef = useRef<THREE.Group>(null);
  const shadowRef = useRef<THREE.Mesh>(null);
  const shadowMaterialRef = useRef<THREE.MeshBasicMaterial>(null);

  useFrame(() => {
    const ball = ballRef.current;
    const shadow = shadowRef.current;
    const shadowMaterial = shadowMaterialRef.current;
    if (ball === null || shadow === null || shadowMaterial === null) {
      return;
    }

    const {
      from,
      to,
      fromHeight,
      launchTick,
      landingTick,
      velocity,
      acceleration,
      peakHeight,
    } = data;
    const flightCycles = (landingTick - launchTick) * CYCLES_PER_TICK;
    const cycle = replayCycle(replay) - launchTick * CYCLES_PER_TICK;
    const flying =
      isInterpolating(replay) && cycle >= 0 && cycle < flightCycles;
    ball.visible = flying;
    shadow.visible = flying;
    if (!flying) {
      return;
    }

    const progress = cycle / flightCycles;
    const x = from.x + (to.x - from.x) * progress;
    const y = from.y + (to.y - from.y) * progress;
    const height =
      fromHeight + velocity * cycle + (acceleration * cycle * cycle) / 2;
    ball.position.set(x, height, -y);
    showCell(
      texture,
      ACID_BALL,
      Math.floor(cycle / ACID_BALL_CYCLES) %
        (ACID_BALL.columns * ACID_BALL.rows),
    );

    const lift = height / peakHeight;
    const radius =
      ACID_SHADOW_RADIUS +
      (ACID_SHADOW_PEAK_RADIUS - ACID_SHADOW_RADIUS) * lift;
    shadow.position.set(x, ACID_SHADOW_HEIGHT, -y);
    shadow.scale.set(radius, radius, 1);
    shadowMaterial.opacity =
      ACID_SHADOW_OPACITY +
      (ACID_SHADOW_PEAK_OPACITY - ACID_SHADOW_OPACITY) * lift;
  });

  return (
    <>
      <group ref={ballRef} visible={false}>
        <Billboard>
          <SheetSprite sheet={ACID_BALL} texture={texture} />
        </Billboard>
      </group>
      <mesh ref={shadowRef} visible={false} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[1, 24]} />
        <meshBasicMaterial
          ref={shadowMaterialRef}
          color="#000000"
          transparent
          depthWrite={false}
        />
      </mesh>
    </>
  );
}

function AcidSplashRenderer({
  entity,
}: {
  entity: CustomEntity<AcidSplashData>;
}) {
  return (
    <Billboard position={osrsToThreePosition(entity.position, 0)}>
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
      position={osrsToThreePosition(entity.position, ACID_POOL_HEIGHT)}
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
