import { SkillLevel } from '@blert/common';
import { Plane, Text } from '@react-three/drei';
import { Vector3, useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';

import { useReplayContext } from './replay-context';

/** Time into a tick at which the health bar begins animating. */
const PAUSE_THRESHOLD = 0.75;

function easeHealthDrop(t: number): number {
  if (t < PAUSE_THRESHOLD) {
    return 0;
  }

  const remainingTime = (t - PAUSE_THRESHOLD) / (1 - PAUSE_THRESHOLD);
  return remainingTime * remainingTime * remainingTime;
}

type HealthBarProps = {
  hitpoints: SkillLevel;
  nextHitpoints?: SkillLevel;
  width?: number;
  height?: number;
  position?: Vector3;
  showFull?: boolean;
};

export default function HealthBar({
  hitpoints,
  nextHitpoints,
  width = 2.5,
  height = 0.3,
  position = [0, 1.0, 0],
  showFull = false,
}: HealthBarProps) {
  const { config, playing } = useReplayContext();

  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const animationStartTime = useRef<number | null>(null);
  const lastHitpoints = useRef<SkillLevel | null>(null);

  const shaderMaterial = useMemo(() => {
    const material = new THREE.ShaderMaterial({
      uniforms: {
        aspect: { value: width / height },
        healthPercent: { value: 1.0 },
        borderWidth: { value: 0.075 },
        healthColorHigh: { value: new THREE.Color('#22c55e') },
        healthColorMid: { value: new THREE.Color('#eab308') },
        healthColorLow: { value: new THREE.Color('#ef4444') },
        backgroundColor: { value: new THREE.Color('#1f2937') },
        borderColor: { value: new THREE.Color('#000000') },
        borderOpacity: { value: 0.8 },
        backgroundOpacity: { value: 0.9 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float aspect;
        uniform float healthPercent;
        uniform float borderWidth;
        uniform vec3 healthColorHigh;
        uniform vec3 healthColorMid;
        uniform vec3 healthColorLow;
        uniform vec3 backgroundColor;
        uniform vec3 borderColor;
        uniform float borderOpacity;
        uniform float backgroundOpacity;
        varying vec2 vUv;
        
        void main() {
          vec2 uv = vUv;
          
          float borderX = borderWidth / aspect;
          if (uv.x < borderX || uv.x > 1.0 - borderX || 
              uv.y < borderWidth || uv.y > 1.0 - borderWidth) {
            gl_FragColor = vec4(borderColor, borderOpacity);
            return;
          }
          
          vec2 borderVec = vec2(borderX, borderWidth);
          vec2 interiorUv = (uv - borderVec) / (1.0 - 2.0 * borderVec);
          
          if (interiorUv.x <= healthPercent) {
            vec3 healthColor;
            if (healthPercent > 0.6) {
              float t = (healthPercent - 0.6) / 0.4;
              healthColor = mix(healthColorMid, healthColorHigh, t);
            } else if (healthPercent > 0.3) {
              float t = (healthPercent - 0.3) / 0.3;
              healthColor = mix(healthColorLow, healthColorMid, t);
            } else {
              healthColor = healthColorLow;
            }
            
            gl_FragColor = vec4(healthColor, 1.0);
          } else {
            gl_FragColor = vec4(backgroundColor, backgroundOpacity);
          }
        }
      `,
      transparent: true,
    });

    return material;
  }, [width, height]);

  const currentHpPercent = hitpoints?.percentage() ?? 0;
  const nextHpPercent = nextHitpoints?.percentage() ?? currentHpPercent;

  useFrame((state) => {
    if (!materialRef.current) {
      return;
    }

    if (!playing || !config.interpolationEnabled || !nextHitpoints) {
      materialRef.current.uniforms.healthPercent.value = currentHpPercent / 100;
      animationStartTime.current = null;
      return;
    }

    const currentTime = state.clock.getElapsedTime() * 1000;

    if (lastHitpoints.current !== hitpoints) {
      animationStartTime.current = currentTime;
      lastHitpoints.current = hitpoints;
    }

    if (animationStartTime.current === null) {
      animationStartTime.current = currentTime;
    }

    const elapsedTime = currentTime - animationStartTime.current;
    const progress = Math.min(elapsedTime / config.tickDuration, 1.0);

    const easedProgress = easeHealthDrop(progress);

    const interpolatedPercent =
      currentHpPercent + (nextHpPercent - currentHpPercent) * easedProgress;
    materialRef.current.uniforms.healthPercent.value =
      interpolatedPercent / 100;

    if (progress >= 1.0) {
      animationStartTime.current = null;
    }
  });

  if (!hitpoints) {
    return null;
  }

  if (!showFull && currentHpPercent >= 100) {
    return null;
  }

  return (
    <group position={position}>
      <Plane args={[width, height]}>
        <primitive
          object={shaderMaterial}
          ref={materialRef}
          attach="material"
        />
      </Plane>
      <Text
        position={[0, -0.035, 0.001]}
        fontSize={0.33}
        color="#ffffff"
        anchorX="center"
        anchorY="middle"
        font="/fonts/runescape.ttf"
        outlineWidth={0.015}
        outlineColor="#000000"
      >
        {hitpoints.toString()}
      </Text>
    </group>
  );
}
