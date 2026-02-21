import { shaderMaterial } from '@react-three/drei';
import { extend, useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';

import {
  CustomEntity,
  easeInQuad,
  easeOutQuart,
  osrsToThreePosition,
  useReplayContext,
} from '@/components/map-renderer';

import { hash } from './hash';

export type DustCloudData = {
  age: number;
  delay: number;
};

const DustPuffMaterial = shaderMaterial(
  {
    uAlpha: 0.92,
    uDarkness: 0.0,
  },
  `
    varying vec3 vNormal;
    varying vec3 vViewDir;
    void main() {
      vNormal = normalize(normalMatrix * normal);
      vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
      vViewDir = normalize(-mvPos.xyz);
      gl_Position = projectionMatrix * mvPos;
    }
  `,
  `
    uniform float uAlpha;
    uniform float uDarkness;
    varying vec3 vNormal;
    varying vec3 vViewDir;

    void main() {
      // Fresnel-based soft edge: faces pointing away from camera fade out.
      float facing = dot(normalize(vNormal), normalize(vViewDir));
      float edge = smoothstep(0.0, 0.5, facing);
      if (edge < 0.01) discard;

      // Darker edges, lighter center.
      vec3 lightColor = vec3(0.62, 0.59, 0.52);
      vec3 darkColor = vec3(0.38, 0.35, 0.30);
      vec3 color = mix(darkColor, lightColor, facing * (1.0 - uDarkness));

      gl_FragColor = vec4(color, uAlpha * edge);
    }
  `,
);

extend({ DustPuffMaterial });

type Puff = {
  offsetX: number;
  offsetZ: number;
  y: number;
  scale: number;
  darkness: number;
};

function generatePuffs(seed: number): Puff[] {
  const puffs: Puff[] = [];

  // Bottom layer: 2-3 larger puffs.
  const bottomCount = 2 + Math.floor(hash(seed + 1.1) * 2);
  for (let i = 0; i < bottomCount; i++) {
    const angle = hash(seed + i * 7.3) * Math.PI * 2;
    const radius = hash(seed + i * 13.1) * 0.2;
    puffs.push({
      offsetX: Math.cos(angle) * radius,
      offsetZ: Math.sin(angle) * radius,
      y: 0.15 + hash(seed + i * 3.7) * 0.1,
      scale: 0.5 + hash(seed + i * 19.7) * 0.2,
      darkness: 0.15 + hash(seed + i * 23.1) * 0.1,
    });
  }

  // Middle layer: 2 medium puffs.
  for (let i = 0; i < 2; i++) {
    const angle = hash(seed + (i + 5) * 11.3) * Math.PI * 2;
    const radius = hash(seed + (i + 5) * 17.1) * 0.15;
    puffs.push({
      offsetX: Math.cos(angle) * radius,
      offsetZ: Math.sin(angle) * radius,
      y: 0.35 + hash(seed + (i + 5) * 5.3) * 0.15,
      scale: 0.4 + hash(seed + (i + 5) * 29.7) * 0.15,
      darkness: 0.05 + hash(seed + (i + 5) * 31.1) * 0.1,
    });
  }

  // Top: 1 smaller puff.
  puffs.push({
    offsetX: hash(seed + 41.3) * 0.1 - 0.05,
    offsetZ: hash(seed + 43.7) * 0.1 - 0.05,
    y: 0.55 + hash(seed + 47.1) * 0.1,
    scale: 0.3 + hash(seed + 51.3) * 0.1,
    darkness: 0.0,
  });

  return puffs;
}

export default function DustCloudRenderer({
  entity,
}: {
  entity: CustomEntity<DustCloudData>;
}) {
  const { config, playing } = useReplayContext();
  const { age, delay } = entity.data;

  const seed =
    Math.abs(entity.position.x * 374.761 + entity.position.y * 668.265) %
    1000.0;

  const position = osrsToThreePosition(entity.position, 0.01);
  const puffs = useMemo(() => generatePuffs(seed), [seed]);

  const groupRef = useRef<THREE.Group>(null);
  const animStartRef = useRef<number | null>(null);

  const shouldAnimate = config.interpolationEnabled && playing;

  useEffect(() => {
    animStartRef.current = null;
  }, [entity]);

  useFrame(({ clock }) => {
    if (groupRef.current === null) {
      return;
    }

    if (!shouldAnimate) {
      groupRef.current.scale.set(1, 1, 1);
      groupRef.current.visible = age === 0;
      groupRef.current.traverse((child) => {
        if (child instanceof THREE.Mesh && child.material) {
          (child.material as InstanceType<typeof DustPuffMaterial>).uAlpha =
            0.92;
        }
      });
      return;
    }

    const now = clock.getElapsedTime() * 1000;
    animStartRef.current ??= now;

    // Stagger animation start by Chebyshev distance from Sol.
    const elapsed = now - animStartRef.current;
    const staggerDelay = delay * config.tickDuration * 0.5;
    const progress = Math.min(
      Math.max(elapsed - staggerDelay, 0) /
        (config.tickDuration - staggerDelay),
      1,
    );

    if (age === 0) {
      // First tick: grow quickly to full size.
      const scale = easeOutQuart(progress);
      groupRef.current.scale.set(scale, scale, scale);
      groupRef.current.visible = progress > 0;
    } else {
      // Second tick: fade out by shrinking and raising.
      const fade = easeInQuad(progress);
      const scale = 1 - fade * 0.6;
      groupRef.current.scale.set(scale, scale, scale);
      groupRef.current.position.y = position[1] + fade * 0.3;
      groupRef.current.visible = true;

      // Fade opacity on all puff materials.
      groupRef.current.traverse((child) => {
        if (child instanceof THREE.Mesh && child.material) {
          (child.material as InstanceType<typeof DustPuffMaterial>).uAlpha =
            0.92 * (1 - fade);
        }
      });
    }
  });

  return (
    <group ref={groupRef} position={position}>
      {puffs.map((puff, i) => (
        <mesh
          key={i}
          position={[puff.offsetX, puff.y, puff.offsetZ]}
          scale={puff.scale}
        >
          <sphereGeometry args={[0.5, 12, 8]} />
          {/* @ts-expect-error dustPuffMaterial is injected via extend() */}
          <dustPuffMaterial
            uDarkness={puff.darkness}
            transparent
            depthWrite={false}
            side={THREE.FrontSide}
          />
        </mesh>
      ))}
    </group>
  );
}
