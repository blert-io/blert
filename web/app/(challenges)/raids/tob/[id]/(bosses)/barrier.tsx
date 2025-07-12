import { Coords } from '@blert/common';
import { shaderMaterial } from '@react-three/drei';
import { extend, useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import * as THREE from 'three';

import { CustomEntity, useReplayContext } from '@/components/map-renderer';

type BarrierData = {
  length: number;
  rotation: number;
};

/** Theatre of Blood room entrance barrier. */
export default class BarrierEntity extends CustomEntity<BarrierData> {
  constructor(position: Coords, length: number, rotation: number = 0) {
    const pos = {
      x: position.x + (length % 2 !== 0 ? 0.5 : 0),
      y: position.y,
    };

    super(
      pos,
      'Barrier',
      length,
      BarrierRenderer,
      { length, rotation },
      `barrier-${position.x}-${position.y}`,
    );
  }
}

const BarrierMaterial = shaderMaterial(
  {
    uTime: 0,
    uColor: new THREE.Color('#922e28'),
    uGlow: new THREE.Color('#e94545'),
    uBandStrength: 0.17,
    uEdgeSoftness: 0.18,
    uAlpha: 0.82,
  },
  `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  `
    uniform float uTime;
    uniform vec3 uColor;
    uniform vec3 uGlow;
    uniform float uBandStrength;
    uniform float uEdgeSoftness;
    uniform float uAlpha;
    varying vec2 vUv;

    void main() {
      float dY = abs(vUv.y - 0.5);
      float edge =
        smoothstep(0.0, uEdgeSoftness, vUv.y) *
        smoothstep(1.0, 1.0 - uEdgeSoftness, vUv.y);

      float band = sin((vUv.y * 10.0) + uTime * 2.0) * uBandStrength;
      float alphaWave = 0.12 + 0.10 * sin(uTime * 2.3 + vUv.x * 2.0);
      float glow = 1.0 - smoothstep(0.4, 0.5, dY);

      vec3 color = mix(uColor, uGlow, glow * 0.55 + band);

      float finalAlpha = uAlpha * edge + alphaWave * edge + glow * 0.07;

      gl_FragColor = vec4(color, finalAlpha);
      gl_FragColor.rgb *= gl_FragColor.a;
    }
  `,
);

extend({ BarrierMaterial });

const BASE_OPACITY = 0.6;

function BarrierRenderer({ entity }: { entity: CustomEntity<BarrierData> }) {
  const { playing } = useReplayContext();
  const materialRef = useRef<THREE.ShaderMaterial>(null!);

  useFrame(({ clock }) => {
    if (playing) {
      materialRef.current.uniforms.uTime.value = clock.getElapsedTime();
    } else {
      materialRef.current.uniforms.uAlpha.value = BASE_OPACITY;
    }
  });

  return (
    <mesh
      position={[entity.position.x, 0.01, -entity.position.y]}
      rotation={[0, entity.data.rotation, 0]}
    >
      <planeGeometry args={[entity.data.length, 1.25]} />
      {/* @ts-expect-error */}
      <barrierMaterial ref={materialRef} transparent side={THREE.DoubleSide} />
    </mesh>
  );
}
