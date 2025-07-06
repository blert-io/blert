'use client';

import { Coords } from '@blert/common';
import { Billboard, Plane, Text, useTexture } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useRef, useMemo, useEffect, useState, Suspense } from 'react';
import * as THREE from 'three';
// @ts-ignore
import { Text as TroikaText } from 'troika-three-text';

import { updateInterpolation, osrsToThreePosition } from './animation';
import HealthBar from './health-bar';
import { useReplayContext } from './replay-context';
import { EntityType, NpcEntity, InterpolationState } from './types';

export interface NpcComponentProps {
  /** Entity data for the NPC */
  entity: NpcEntity;

  /** Callback when the NPC is clicked */
  onClicked?: (entity: NpcEntity) => void;

  /** Callback when the NPC is hovered/unhovered */
  onHover?: (entity: NpcEntity | null) => void;

  /** Whether this NPC is currently selected */
  isSelected?: boolean;

  /** Whether this NPC is currently hovered */
  isHovered?: boolean;
}

const vertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = `
  uniform sampler2D u_texture;
  uniform vec4 u_outlineColor;
  uniform float u_outlineThickness;
  uniform vec2 u_textureResolution;
  varying vec2 vUv;

  void main() {
    vec4 originalColor = texture2D(u_texture, vUv);

    if (originalColor.a > 0.5) {
      gl_FragColor = originalColor;
      return;
    }
    
    vec2 texelSize = 1.0 / u_textureResolution;
    float maxAlpha = 0.0;

    for (int x = -1; x <= 1; x++) {
      for (int y = -1; y <= 1; y++) {
        if (x == 0 && y == 0 || abs(x) == abs(y)) continue;
        vec2 offset = vec2(float(x), float(y)) * texelSize * u_outlineThickness;
        maxAlpha = max(maxAlpha, texture2D(u_texture, vUv + offset).a);
      }
    }
    
    if (maxAlpha > 0.5) {
      gl_FragColor = u_outlineColor;
    } else {
      discard;
    }
  }
`;

const SELECTED_COLOR = new THREE.Color('#5865f2');
const HOVERED_COLOR = new THREE.Color('#f59e0b');
const BORDER_COLOR = new THREE.Color('#c3c7c9');

function NpcFallback({ width, height }: { width: number; height: number }) {
  const matRef = useRef<THREE.MeshBasicMaterial>(null);

  useFrame(({ clock }) => {
    if (matRef.current) {
      const pulse = 0.45 + 0.1 * Math.sin(clock.getElapsedTime() * 2.0);
      matRef.current.opacity = pulse;
    }
  });

  return (
    <group>
      <mesh scale={[width, height, 1]}>
        <planeGeometry args={[1, 1, 8, 8]} />
        <meshBasicMaterial
          ref={matRef}
          color="#5865f2"
          transparent
          opacity={0.5}
        />
      </mesh>
      <Text
        position={[0, height * 0.6, 0.01]}
        fontSize={height * 0.5}
        color="#fff"
        anchorX="center"
        anchorY="middle"
        font="/fonts/runescape.ttf"
        outlineWidth={0.04}
        outlineColor="#000"
        maxWidth={width * 0.95}
      >
        ?
      </Text>
    </group>
  );
}

function NpcSpriteMesh({
  aspect,
  baseHeight,
  isSelected,
  isHovered,
  npcEntity,
  setAspect,
}: {
  aspect: number;
  baseHeight: number;
  isSelected: boolean;
  isHovered: boolean;
  npcEntity: NpcEntity;
  setAspect: (n: number) => void;
}) {
  const meshRef = useRef<THREE.Mesh>(null);

  const spriteTexture = useTexture(npcEntity.imageUrl, (texture) => {
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    setAspect(texture.image.width / texture.image.height);
  });

  const outlineMaterial = useMemo(() => {
    const outlineColor = SELECTED_COLOR;
    return new THREE.ShaderMaterial({
      uniforms: {
        u_texture: { value: spriteTexture },
        u_textureResolution: {
          value: new THREE.Vector2(
            spriteTexture.image.width,
            spriteTexture.image.height,
          ),
        },
        u_outlineColor: {
          value: new THREE.Vector4(
            outlineColor.r,
            outlineColor.g,
            outlineColor.b,
            1.0,
          ),
        },
        u_outlineThickness: { value: 0.0 },
      },
      vertexShader,
      fragmentShader,
      transparent: true,
      side: THREE.DoubleSide,
    });
  }, [spriteTexture]);

  useEffect(() => {
    outlineMaterial.uniforms.u_outlineThickness.value =
      isSelected || isHovered ? 8.0 : 0.0;

    if (isSelected) {
      outlineMaterial.uniforms.u_outlineColor.value = new THREE.Vector4(
        SELECTED_COLOR.r,
        SELECTED_COLOR.g,
        SELECTED_COLOR.b,
        1.0,
      );
    } else if (isHovered) {
      outlineMaterial.uniforms.u_outlineColor.value = new THREE.Vector4(
        HOVERED_COLOR.r,
        HOVERED_COLOR.g,
        HOVERED_COLOR.b,
        1.0,
      );
    }
  }, [outlineMaterial, isSelected, isHovered]);

  return (
    <mesh
      ref={meshRef}
      scale={[baseHeight * aspect, baseHeight, 1]}
      material={outlineMaterial}
    >
      <planeGeometry args={[1, 1]} />
    </mesh>
  );
}

export default function Npc({
  entity,
  onClicked,
  onHover,
  isSelected = false,
  isHovered = false,
}: NpcComponentProps) {
  const groupRef = useRef<THREE.Group>(null);
  const borderMeshRef = useRef<THREE.Mesh>(null);

  const interpolationStateRef = useRef<InterpolationState | null>(null);
  const currentPositionRef = useRef<Coords | null>(null);
  const debugTextRef = useRef<TroikaText>(null);
  const [aspect, setAspect] = useState(1);
  const { config, playing, mapDefinition } = useReplayContext();

  const npcEntity = entity as NpcEntity;
  const hitpoints = npcEntity.hitpoints;

  const planeSize = entity.size;

  const borderMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: {
        thickness: { value: 0.01 },
        planeSize: { value: planeSize },
        borderWidth: { value: 0.05 },
        borderColor: {
          value: new THREE.Vector4(
            BORDER_COLOR.r,
            BORDER_COLOR.g,
            BORDER_COLOR.b,
            0.5,
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
  }, [planeSize]);

  useFrame((state) => {
    if (!groupRef.current) {
      return;
    }

    const currentTime = state.clock.getElapsedTime() * 1000;

    const { position, interpolationState: newInterpolationState } =
      updateInterpolation(
        entity,
        interpolationStateRef.current,
        config,
        playing,
        currentTime,
        mapDefinition.terrain,
      );

    interpolationStateRef.current = newInterpolationState;
    currentPositionRef.current = position;

    const sizeOffset = (entity.size - 1) / 2;
    const adjustedPosition = {
      x: position.x + sizeOffset,
      y: position.y + sizeOffset,
    };

    const threePosition = osrsToThreePosition(
      adjustedPosition,
      entity.size / 2 - 0.2,
    );
    groupRef.current.position.set(...threePosition);

    if (borderMeshRef.current) {
      borderMeshRef.current.position.set(
        threePosition[0],
        -0.002,
        threePosition[2],
      );
    }

    if (config.debug && debugTextRef.current) {
      debugTextRef.current.text = `Render: ${position.x.toFixed(2)}, ${position.y.toFixed(2)}`;
    }
  });

  if (entity.type !== EntityType.NPC) {
    console.warn('NPC component received non-NPC entity:', entity);
    return null;
  }

  const handleClick = () => {
    if (onClicked && entity.interactive) {
      onClicked(entity);
    }
  };

  const handlePointerOver = () => {
    if (entity.interactive && onHover) {
      onHover(entity);
    }
  };

  const handlePointerOut = () => {
    if (entity.interactive && onHover) {
      onHover(null);
    }
  };

  const baseHeight = entity.size * 0.9;

  return (
    <>
      <mesh
        ref={borderMeshRef}
        scale={planeSize}
        material={borderMaterial}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <planeGeometry args={[1, 1]} />
      </mesh>
      <Billboard ref={groupRef}>
        <group
          onClick={handleClick}
          onPointerOver={handlePointerOver}
          onPointerOut={handlePointerOut}
        >
          <Suspense
            fallback={
              <NpcFallback width={baseHeight * aspect} height={baseHeight} />
            }
          >
            <NpcSpriteMesh
              aspect={aspect}
              baseHeight={baseHeight}
              isSelected={isSelected}
              isHovered={isHovered}
              npcEntity={npcEntity}
              setAspect={setAspect}
            />
          </Suspense>
        </group>
        <Text
          position={[0, 1.5 + (entity.size - 1) * 0.5, 0]}
          fontSize={0.5}
          color="#ffffff"
          anchorX="center"
          anchorY="middle"
          font="/fonts/runescape.ttf"
          outlineWidth={0.03}
          outlineColor="#000000"
          maxWidth={5}
        >
          {entity.name}
        </Text>

        {hitpoints && (
          <group position={[0, (entity.size - 1) * 0.5, 0]}>
            <HealthBar
              hitpoints={hitpoints.current}
              nextHitpoints={hitpoints.next}
              width={2 * entity.size}
              showFull
            />
          </group>
        )}

        {config.debug && (
          <group>
            <Plane
              args={[3, 1.25]}
              position={[0, 2.5 + (entity.size - 1) * 0.5, 0]}
            >
              <meshBasicMaterial color="#000000" transparent opacity={0.8} />
            </Plane>

            <Text
              position={[0, 2.8 + (entity.size - 1) * 0.5, 0.001]}
              fontSize={0.18}
              color="#ffffff"
              anchorX="center"
              anchorY="middle"
              font="/fonts/runescape.ttf"
              outlineWidth={0.02}
              outlineColor="#000000"
            >
              {`Tick: ${entity.position.x}, ${entity.position.y}`}
            </Text>

            <Text
              ref={debugTextRef}
              position={[0, 2.6 + (entity.size - 1) * 0.5, 0.001]}
              fontSize={0.18}
              color="#22c55e"
              anchorX="center"
              anchorY="middle"
              font="/fonts/runescape.ttf"
              outlineWidth={0.02}
              outlineColor="#000000"
            >
              Render:
            </Text>

            <Text
              position={[0, 2.4 + (entity.size - 1) * 0.5, 0.001]}
              fontSize={0.16}
              color="#64748b"
              anchorX="center"
              anchorY="middle"
              font="/fonts/runescape.ttf"
              outlineWidth={0.02}
              outlineColor="#000000"
            >
              {`Next: ${entity.nextPosition?.x || 'N/A'}, ${entity.nextPosition?.y || 'N/A'}`}
            </Text>

            <Text
              position={[0, 2.15 + (entity.size - 1) * 0.5, 0.001]}
              fontSize={0.18}
              color="#94a3b8"
              anchorX="center"
              anchorY="middle"
              font="/fonts/runescape.ttf"
              outlineWidth={0.02}
              outlineColor="#000000"
            >
              {`ID: ${npcEntity.id || 'N/A'}, RoomID: ${npcEntity.roomId || 'N/A'}`}
            </Text>
            <Text
              position={[0, 1.95 + (entity.size - 1) * 0.5, 0.001]}
              fontSize={0.14}
              color={isSelected ? '#5865f2' : isHovered ? '#f59e0b' : '#6b7280'}
              anchorX="center"
              anchorY="middle"
              font="/fonts/runescape.ttf"
              outlineWidth={0.02}
              outlineColor="#000000"
            >
              {isSelected ? 'SELECTED' : isHovered ? 'HOVERED' : 'IDLE'}
            </Text>
          </group>
        )}
      </Billboard>
    </>
  );
}
