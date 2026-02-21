import { shaderMaterial } from '@react-three/drei';
import { extend, useFrame } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';

import {
  CustomEntity,
  easeInQuad,
  easeOutCubic,
  osrsToThreePosition,
  useReplayContext,
} from '@/components/map-renderer';

export type SolPoolData = {
  settled: boolean;
  age: number;
};

const SETTLED_CENTER = new THREE.Color('#ffe030');
const SETTLED_EDGE = new THREE.Color('#8b7500');
const NEW_CENTER = new THREE.Color('#fffde0');
const NEW_EDGE = new THREE.Color('#e8d870');
const BEAM_COLOR = new THREE.Color('#ffe040');

const BEAM_HEIGHT = 12;

const SolPoolMaterial = shaderMaterial(
  {
    uCenterColor: new THREE.Color(),
    uEdgeColor: new THREE.Color(),
    uAlpha: 0.85,
    uBands: 5.0,
  },
  `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  `
    uniform vec3 uCenterColor;
    uniform vec3 uEdgeColor;
    uniform float uAlpha;
    uniform float uBands;
    varying vec2 vUv;

    void main() {
      vec2 centered = vUv - 0.5;
      float dist = length(centered) * 2.0;

      // Circular mask with soft edge.
      float circle = 1.0 - smoothstep(0.85, 1.0, dist);

      // Stepped radial gradient for concentric band effect.
      float banded = floor(dist * uBands) / uBands;
      vec3 color = mix(uCenterColor, uEdgeColor, banded);

      gl_FragColor = vec4(color, uAlpha * circle);
    }
  `,
);

extend({ SolPoolMaterial });

export default function SolPoolRenderer({
  entity,
}: {
  entity: CustomEntity<SolPoolData>;
}) {
  const { config, playing } = useReplayContext();
  const { settled, age } = entity.data;

  const poolRef = useRef<THREE.Mesh>(null);
  const beamRef = useRef<THREE.Mesh>(null);
  const animStartRef = useRef<number | null>(null);

  const shouldAnimate = config.interpolationEnabled && playing;

  useEffect(() => {
    animStartRef.current = null;
  }, [entity]);

  useFrame(({ clock }) => {
    if (!poolRef.current) {
      return;
    }

    if (!shouldAnimate) {
      poolRef.current.scale.set(1, 1, 1);
      if (beamRef.current) {
        beamRef.current.visible = false;
      }
      return;
    }

    const now = clock.getElapsedTime() * 1000;
    animStartRef.current ??= now;
    const progress = Math.min(
      (now - animStartRef.current) / config.tickDuration,
      1,
    );

    if (age === 0) {
      // First tick: grow outward quickly.
      const scale = easeOutCubic(progress);
      poolRef.current.scale.set(scale, scale, 1);
    } else {
      poolRef.current.scale.set(1, 1, 1);
    }

    if (beamRef.current) {
      if (age === 2) {
        // Third tick: beam comes down from the sky.
        beamRef.current.visible = true;
        const beamProgress = easeInQuad(progress);
        const currentHeight = BEAM_HEIGHT * (1 - beamProgress);
        beamRef.current.position.y = currentHeight / 2;
        beamRef.current.scale.y = 1 - beamProgress;
        (beamRef.current.material as THREE.MeshBasicMaterial).opacity =
          0.7 * (1 - beamProgress * 0.5);
      } else {
        beamRef.current.visible = false;
      }
    }
  });

  const centerColor = settled ? SETTLED_CENTER : NEW_CENTER;
  const edgeColor = settled ? SETTLED_EDGE : NEW_EDGE;

  const position = osrsToThreePosition(entity.position, 0.015);

  return (
    <group position={position}>
      <mesh
        ref={poolRef}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={shouldAnimate && age === 0 ? [0, 0, 1] : undefined}
      >
        <planeGeometry args={[1, 1]} />
        {/* @ts-expect-error solPoolMaterial is injected via extend() */}
        <solPoolMaterial
          uCenterColor={centerColor}
          uEdgeColor={edgeColor}
          transparent
          depthWrite={false}
        />
      </mesh>
      {age === 2 && (
        <mesh ref={beamRef} visible={false}>
          <cylinderGeometry args={[0.15, 0.35, BEAM_HEIGHT, 8]} />
          <meshBasicMaterial
            color={BEAM_COLOR}
            transparent
            opacity={0.7}
            depthWrite={false}
          />
        </mesh>
      )}
    </group>
  );
}
