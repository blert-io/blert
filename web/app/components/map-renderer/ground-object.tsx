'use client';

import { useTexture } from '@react-three/drei';
import { useRef, useMemo, useState, Suspense } from 'react';
import * as THREE from 'three';

import { osrsToThreePosition } from './animation';
import { EntityType, GroundObjectEntity } from './types';

export interface GroundObjectComponentProps {
  /** Entity data for the ground object */
  entity: GroundObjectEntity;
}

const DEFAULT_BORDER_COLOR = new THREE.Color('#c3c7c9');

function GroundObjectFallback({ size }: { size: number }) {
  const matRef = useRef<THREE.MeshBasicMaterial>(null);

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} scale={[size, size, 1]}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial
        ref={matRef}
        color="#888888"
        transparent
        opacity={0.5}
      />
    </mesh>
  );
}

function GroundObjectSpriteMesh({
  entity,
  size,
}: {
  entity: GroundObjectEntity;
  size: number;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const [aspect, setAspect] = useState(1);

  const spriteTexture = useTexture(entity.imageUrl, (texture) => {
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    setAspect(texture.image.width / texture.image.height);
  });

  return (
    <mesh
      ref={meshRef}
      rotation={[-Math.PI / 2, 0, 0]}
      scale={[size * aspect, size, 1]}
    >
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial
        map={spriteTexture}
        transparent
        side={THREE.DoubleSide}
        opacity={0.9}
      />
    </mesh>
  );
}

export default function GroundObject({ entity }: GroundObjectComponentProps) {
  const groupRef = useRef<THREE.Group>(null);
  const borderMeshRef = useRef<THREE.Mesh>(null);

  const borderColor = useMemo(() => {
    return entity.borderColor
      ? new THREE.Color(entity.borderColor)
      : DEFAULT_BORDER_COLOR;
  }, [entity.borderColor]);

  const borderMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: {
        thickness: { value: 0.01 },
        planeSize: { value: entity.size },
        borderWidth: { value: 0.05 },
        borderColor: {
          value: new THREE.Vector4(
            borderColor.r,
            borderColor.g,
            borderColor.b,
            0.3,
          ),
        },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float thickness;
        uniform float planeSize;
        uniform float borderWidth;
        uniform vec4 borderColor;
        varying vec2 vUv;
        void main() {
          float thicknessUv = borderWidth / planeSize;
          float edge = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
          if (edge < thicknessUv) {
            gl_FragColor = borderColor;
          } else {
            discard;
          }
        }
      `,
      transparent: true,
      depthWrite: false,
    });
  }, [entity.size, borderColor]);

  if (entity.type !== EntityType.GROUND_OBJECT) {
    console.warn(
      'GroundObject component received non-ground-object entity:',
      entity,
    );
    return null;
  }

  const sizeOffset = (entity.size - 1) / 2;
  const adjustedPosition = {
    x: entity.position.x + sizeOffset,
    y: entity.position.y + sizeOffset,
  };

  const threePosition = osrsToThreePosition(adjustedPosition, 0);
  const position: [number, number, number] = [
    threePosition[0],
    0.001,
    threePosition[2],
  ];

  const borderPosition: [number, number, number] = [
    threePosition[0],
    0.0005,
    threePosition[2],
  ];

  return (
    <>
      {entity.borderColor && (
        <mesh
          ref={borderMeshRef}
          position={borderPosition}
          scale={entity.size}
          material={borderMaterial}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <planeGeometry args={[1, 1]} />
        </mesh>
      )}
      <group ref={groupRef} position={position}>
        <Suspense fallback={<GroundObjectFallback size={entity.size * 0.9} />}>
          <GroundObjectSpriteMesh entity={entity} size={entity.size * 0.9} />
        </Suspense>
      </group>
    </>
  );
}
