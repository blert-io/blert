import { shaderMaterial } from '@react-three/drei';
import { extend, useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';

import {
  CustomEntity,
  easeInQuad,
  easeInOutCubic,
  easeOutCubic,
  useReplayContext,
} from '@/components/map-renderer';

import { hash } from './hash';

export type BeamAxis = 'x' | 'y';
export type LaserPhase = 'scan' | 'shot' | 'residual';

export type LaserBeamData = {
  axis: BeamAxis;
  fixedCoord: number;
  startVar: number;
  endVar: number;
  prismVar: number;
  phase: LaserPhase;
  phaseAge: number;
  phaseDuration: number;
  isFirstAppearance: boolean;
};

const BEAM_WIDTH = 0.08;
const BEAM_HEIGHT = 0.02;
const BEAM_Y = 0.33;
const SHOT_BALL_SIZE = 1;
const SPARKLE_COUNT = 24;

const LaserBeamMaterial = shaderMaterial(
  {
    uAlpha: 1.0,
    uPulse: 0.0,
  },
  `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  `
    uniform float uAlpha;
    uniform float uPulse;
    varying vec2 vUv;

    void main() {
      // Cross-section distance from beam center.
      float dist = abs(vUv.x - 0.5) * 2.0;

      // Core-to-edge gradient: white center, yellow edges.
      vec3 coreColor = vec3(1.0, 1.0, 0.95);
      vec3 edgeColor = vec3(1.0, 0.88, 0.25);
      vec3 color = mix(coreColor, edgeColor, smoothstep(0.0, 0.8, dist));

      // Subtle pulse brightness.
      color *= 1.0 + uPulse * 0.15;

      // Soft edge falloff.
      float edgeAlpha = 1.0 - smoothstep(0.6, 1.0, dist);

      gl_FragColor = vec4(color, uAlpha * edgeAlpha);
    }
  `,
);

const StarburstMaterial = shaderMaterial(
  {
    uAlpha: 1.0,
  },
  `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  `
    uniform float uAlpha;
    varying vec2 vUv;

    void main() {
      vec2 p = (vUv - 0.5) * 2.0;
      float dist = length(p);
      float angle = atan(p.y, p.x);

      // Bright core.
      float core = 1.0 - smoothstep(0.0, 0.35, dist);

      // Spiky rays: 8 major + 8 minor.
      float majorRays = pow(max(cos(angle * 4.0), 0.0), 4.0);
      float minorRays = pow(max(cos(angle * 4.0 + 0.3927), 0.0), 8.0);
      float rays = majorRays * 0.8 + minorRays * 0.4;

      // Rays fade with distance.
      float rayMask = rays * (1.0 - smoothstep(0.1, 0.9, dist));

      float brightness = core + rayMask;
      if (brightness < 0.01) discard;

      // White core fading to yellow in rays.
      vec3 white = vec3(1.0, 1.0, 0.95);
      vec3 yellow = vec3(1.0, 0.9, 0.2);
      vec3 color = mix(yellow, white, core);

      gl_FragColor = vec4(color, uAlpha * min(brightness, 1.0));
    }
  `,
);

extend({ LaserBeamMaterial, StarburstMaterial });

type Sparkle = {
  along: number;
  perp: number;
  y: number;
  scale: number;
  phase: number;
};

function generateSparkles(seed: number): Sparkle[] {
  const sparkles: Sparkle[] = [];
  for (let i = 0; i < SPARKLE_COUNT; i++) {
    sparkles.push({
      along: hash(seed + i * 7.3),
      perp: (hash(seed + i * 13.1) - 0.5) * 0.4,
      y: hash(seed + i * 19.7) * 0.2,
      scale: 0.02 + hash(seed + i * 23.3) * 0.03,
      phase: hash(seed + i * 29.1) * Math.PI * 2,
    });
  }
  return sparkles;
}

function beamPosition(
  axis: BeamAxis,
  fixedCoord: number,
  varCoord: number,
): [number, number, number] {
  if (axis === 'x') {
    return [fixedCoord + 0.5, BEAM_Y, -(varCoord + 0.5)];
  }
  return [varCoord + 0.5, BEAM_Y, -(fixedCoord + 0.5)];
}

export default function LaserBeamRenderer({
  entity,
}: {
  entity: CustomEntity<LaserBeamData>;
}) {
  const { config, playing } = useReplayContext();
  const data = entity.data;

  const beamLength = data.endVar - data.startVar + 1;
  const beamMidVar = (data.startVar + data.endVar) / 2;
  const beamCenter = beamPosition(data.axis, data.fixedCoord, beamMidVar);
  const beamRotation: [number, number, number] =
    data.axis === 'x' ? [0, 0, 0] : [0, Math.PI / 2, 0];

  const travelForward =
    Math.abs(data.prismVar - data.startVar) <
    Math.abs(data.prismVar - data.endVar);

  const seed =
    Math.abs(data.fixedCoord * 374.761 + data.startVar * 668.265) % 1000;
  const sparkles = useMemo(() => generateSparkles(seed), [seed]);

  const groupRef = useRef<THREE.Group>(null);
  const beamRef = useRef<THREE.Mesh>(null);
  const beamMatRef = useRef<InstanceType<typeof LaserBeamMaterial>>(null);
  const shotBallRef = useRef<THREE.Mesh>(null);
  const shotBallMatRef = useRef<InstanceType<typeof StarburstMaterial>>(null);
  const sparklesRef = useRef<THREE.Group>(null);
  const animStartRef = useRef<number | null>(null);

  const shouldAnimate = config.interpolationEnabled && playing;

  useEffect(() => {
    animStartRef.current = null;
  }, [entity]);

  const showSparkles = !data.isFirstAppearance && data.phase !== 'residual';
  const showResidualSparkles = data.phase === 'residual';

  useFrame(({ clock }) => {
    if (groupRef.current === null) {
      return;
    }

    const now = clock.getElapsedTime() * 1000;
    animStartRef.current ??= now;
    const progress = Math.min(
      (now - animStartRef.current) / config.tickDuration,
      1,
    );

    if (beamRef.current !== null) {
      if (data.phase === 'residual') {
        beamRef.current.visible = false;
      } else if (
        data.phase === 'scan' &&
        data.isFirstAppearance &&
        shouldAnimate
      ) {
        // Extend beam from prism end.
        beamRef.current.visible = true;
        const scale = easeOutCubic(progress);
        beamRef.current.scale.set(1, 1, scale);

        // Offset so beam grows from the prism end.
        // For axis 'x', the z coordinate is negated, flipping the direction.
        const axisSign = data.axis === 'x' ? -1 : 1;
        const offset =
          (((1 - scale) * beamLength) / 2) *
          (travelForward ? -1 : 1) *
          axisSign;
        const pos = beamPosition(data.axis, data.fixedCoord, beamMidVar);
        if (data.axis === 'x') {
          pos[2] += offset;
        } else {
          pos[0] += offset;
        }
        beamRef.current.position.set(pos[0], pos[1], pos[2]);
        if (beamMatRef.current !== null) {
          beamMatRef.current.uAlpha = 0.9;
        }
      } else if (data.phase === 'shot' && shouldAnimate) {
        // Beam clears behind the traveling shot ball.
        const overallProgress = Math.min(
          (data.phaseAge + easeInOutCubic(progress)) / data.phaseDuration,
          1,
        );
        const consumed = overallProgress;
        const remaining = 1 - consumed;

        if (remaining < 0.01) {
          beamRef.current.visible = false;
        } else {
          beamRef.current.visible = true;
          beamRef.current.scale.set(1, 1, remaining);

          // Position remaining beam ahead of the ball.
          const remainingMidT = travelForward
            ? consumed + remaining / 2
            : remaining / 2;
          const remainingMidVar = data.startVar + remainingMidT * beamLength;
          const pos = beamPosition(data.axis, data.fixedCoord, remainingMidVar);
          beamRef.current.position.set(pos[0], pos[1], pos[2]);
          if (beamMatRef.current !== null) {
            beamMatRef.current.uAlpha = 0.9;
          }
        }
      } else {
        beamRef.current.visible = true;
        beamRef.current.scale.set(1, 1, 1);
        beamRef.current.position.set(
          beamCenter[0],
          beamCenter[1],
          beamCenter[2],
        );

        if (beamMatRef.current !== null) {
          if (shouldAnimate) {
            const pulse = Math.sin(progress * Math.PI * 2) * 0.5 + 0.5;
            beamMatRef.current.uPulse = pulse;
          } else {
            beamMatRef.current.uPulse = 0;
          }
          beamMatRef.current.uAlpha = 0.9;
        }
      }
    }

    if (shotBallRef.current !== null) {
      if (data.phase === 'shot') {
        shotBallRef.current.visible = true;
        const overallProgress = shouldAnimate
          ? Math.min(
              (data.phaseAge + easeInOutCubic(progress)) / data.phaseDuration,
              1,
            )
          : (data.phaseAge + 0.5) / data.phaseDuration;

        const ballT = travelForward ? overallProgress : 1 - overallProgress;
        const ballVar = data.startVar + ballT * beamLength;
        const ballPos = beamPosition(data.axis, data.fixedCoord, ballVar);
        shotBallRef.current.position.set(ballPos[0], ballPos[1], ballPos[2]);
        if (shotBallMatRef.current !== null) {
          shotBallMatRef.current.uAlpha = 1.0;
        }
      } else {
        shotBallRef.current.visible = false;
      }
    }

    if (sparklesRef.current !== null) {
      if (shouldAnimate && (showSparkles || showResidualSparkles)) {
        sparklesRef.current.visible = true;

        let alpha = 0.8;
        if (showResidualSparkles) {
          const residualProgress =
            (data.phaseAge + (shouldAnimate ? progress : 0.5)) /
            data.phaseDuration;
          alpha = 0.8 * (1 - easeInQuad(Math.min(residualProgress, 1)));
        }

        const timeS = now / 1000;
        sparklesRef.current.children.forEach((child, i) => {
          if (child instanceof THREE.Sprite) {
            const sparkle = sparkles[i];
            if (sparkle === undefined) {
              return;
            }
            const twinkle = 0.5 + 0.5 * Math.sin(timeS * 8 + sparkle.phase);
            const s = sparkle.scale * (0.5 + twinkle * 0.5);
            child.scale.set(s, s, 1);
            child.material.opacity = alpha * twinkle;
          }
        });
      } else {
        sparklesRef.current.visible = false;
      }
    }
  });

  return (
    <group ref={groupRef}>
      <mesh ref={beamRef} position={beamCenter} rotation={beamRotation}>
        <boxGeometry args={[BEAM_WIDTH, BEAM_HEIGHT, beamLength]} />
        {/* @ts-expect-error laserBeamMaterial is injected via extend() */}
        <laserBeamMaterial
          ref={beamMatRef}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>

      <mesh ref={shotBallRef} visible={false} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[SHOT_BALL_SIZE, SHOT_BALL_SIZE]} />
        {/* @ts-expect-error starburstMaterial is injected via extend() */}
        <starburstMaterial
          ref={shotBallMatRef}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>

      <group ref={sparklesRef} visible={false}>
        {sparkles.map((sparkle, i) => {
          const alongVar = data.startVar + sparkle.along * beamLength;
          const pos = beamPosition(data.axis, data.fixedCoord, alongVar);
          if (data.axis === 'x') {
            pos[0] += sparkle.perp;
          } else {
            pos[2] += sparkle.perp;
          }
          pos[1] += sparkle.y;

          return (
            <sprite
              key={i}
              position={pos}
              scale={[sparkle.scale, sparkle.scale, 1]}
            >
              <spriteMaterial
                color="#ffe880"
                transparent
                opacity={0.8}
                depthWrite={false}
              />
            </sprite>
          );
        })}
      </group>
    </group>
  );
}
