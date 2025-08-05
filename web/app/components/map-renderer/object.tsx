'use client';

import { Billboard, useTexture } from '@react-three/drei';
import { useRef, useMemo, useState, Suspense } from 'react';
import * as THREE from 'three';

import { osrsToThreePosition } from './animation';
import { EntityType, ObjectEntity } from './types';

export interface ObjectComponentProps {
  /** Entity data for the ground object */
  entity: ObjectEntity;
}

const DEFAULT_BORDER_COLOR = new THREE.Color('#c3c7c9');

function ObjectFallback({
  size,
  rotation,
}: {
  size: number;
  rotation?: [number, number, number];
}) {
  const matRef = useRef<THREE.MeshBasicMaterial>(null);

  return (
    <mesh rotation={rotation} scale={[size, size, 1]}>
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

function ObjectSpriteMesh({
  entity,
  size,
}: {
  entity: ObjectEntity;
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
      rotation={[entity.layFlat ? -Math.PI / 2 : 0, 0, 0]}
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

export default function Object({ entity }: ObjectComponentProps) {
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

  if (entity.type !== EntityType.OBJECT) {
    console.warn('Object component received non-object entity:', entity);
    return null;
  }

  const sizeOffset = (entity.size - 1) / 2;
  const adjustedPosition = {
    x: entity.position.x + sizeOffset,
    y: entity.position.y + sizeOffset,
  };

  const y = entity.layFlat ? 0.001 : entity.size / 2 - 0.25;
  const position = osrsToThreePosition(adjustedPosition, y);

  const borderPosition: [number, number, number] = [
    position[0],
    0.0005,
    position[2],
  ];

  let objectGroup;
  if (entity.layFlat) {
    objectGroup = (
      <group ref={groupRef} position={position}>
        <Suspense
          fallback={
            <ObjectFallback
              size={entity.size * 0.9}
              rotation={[-Math.PI / 2, 0, 0]}
            />
          }
        >
          <ObjectSpriteMesh entity={entity} size={entity.size * 0.9} />
        </Suspense>
      </group>
    );
  } else {
    objectGroup = (
      <Billboard ref={groupRef} position={position}>
        <Suspense fallback={<ObjectFallback size={entity.size * 0.9} />}>
          <ObjectSpriteMesh entity={entity} size={entity.size * 0.9} />
        </Suspense>
      </Billboard>
    );
  }

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
      {objectGroup}
    </>
  );
}
