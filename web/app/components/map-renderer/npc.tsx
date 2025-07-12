'use client';

import { Coords } from '@blert/common';
import { Billboard, Plane, Text, useTexture } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useRef, useMemo, useEffect, useState, Suspense } from 'react';
import * as THREE from 'three';
// @ts-ignore
import { Text as TroikaText } from 'troika-three-text';

import {
  updateInterpolation,
  osrsToThreePosition,
  calculateFanOutOffset,
} from './animation';
import HealthBar from './health-bar';
import { useReplayContext } from './replay-context';
import {
  EntityType,
  InteractiveEntityProps,
  InterpolationState,
  NpcEntity,
} from './types';

export interface NpcComponentProps extends InteractiveEntityProps<NpcEntity> {}

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
  uniform bool u_isDimmed;
  uniform float u_dimOpacity;

  void main() {
    vec4 originalColor = texture2D(u_texture, vUv);

    if (u_isDimmed) {
      float luminance = dot(originalColor.rgb, vec3(0.299, 0.587, 0.114));
      vec3 grayscale = vec3(luminance);
      float desaturation = 0.85;
      vec3 desaturated = mix(grayscale, originalColor.rgb, desaturation);
      gl_FragColor = vec4(desaturated, originalColor.a * u_dimOpacity);
      return;
    }

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
  spriteWidth,
  spriteHeight,
  isSelected,
  isHovered,
  isDimmed,
  npcEntity,
  setAspect,
}: {
  spriteWidth: number;
  spriteHeight: number;
  isSelected: boolean;
  isHovered: boolean;
  isDimmed: boolean;
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
        u_isDimmed: { value: false },
        u_dimOpacity: { value: 0.5 },
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
    outlineMaterial.uniforms.u_isDimmed.value = isDimmed;

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
  }, [outlineMaterial, isSelected, isHovered, isDimmed]);

  return (
    <mesh
      ref={meshRef}
      scale={[spriteWidth, spriteHeight, 1]}
      material={outlineMaterial}
    >
      <planeGeometry args={[1, 1]} />
    </mesh>
  );
}

export default function Npc({
  entity,
  onClicked,
  isSelected = false,
  isHovered = false,
  isDimmed = false,
  fanOutIndex,
  stackSize,
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

  const maxSize = entity.size * 0.9;
  const finalScale = Math.min(maxSize, maxSize / aspect);

  const spriteWidth = finalScale * aspect;
  const spriteHeight = finalScale;

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

    const {
      position: basePosition,
      interpolationState: newInterpolationState,
    } = updateInterpolation(
      entity,
      interpolationStateRef.current,
      config,
      playing,
      currentTime,
      mapDefinition.terrain,
    );

    interpolationStateRef.current = newInterpolationState;
    currentPositionRef.current = basePosition;

    const sizeOffset = (entity.size - 1) / 2;
    const adjustedPosition = {
      x: basePosition.x + sizeOffset,
      y: basePosition.y + sizeOffset,
    };

    if (playing && npcEntity.options.customInterpolation) {
      const { from, to, ease } = npcEntity.options.customInterpolation;
      const elapsed = currentTime - interpolationStateRef.current!.startTime;
      const progress = Math.min(elapsed / config.tickDuration, 1);
      const easedProgress = ease ? ease(progress) : progress;

      const start = new THREE.Vector3(...from);
      const end = new THREE.Vector3(...to);
      groupRef.current.position.lerpVectors(start, end, easedProgress);
    } else {
      let finalPosition = adjustedPosition;

      if (fanOutIndex !== undefined && stackSize > 1) {
        const offset = calculateFanOutOffset(
          fanOutIndex,
          stackSize,
          entity.size,
        );
        finalPosition = {
          x: adjustedPosition.x + offset.x,
          y: adjustedPosition.y + offset.y,
        };
      }

      const threePosition = osrsToThreePosition(
        finalPosition,
        spriteHeight / 2 - 0.2,
      );
      if (fanOutIndex !== undefined) {
        const targetPosition = new THREE.Vector3(...threePosition);
        groupRef.current.position.lerp(targetPosition, 0.1);
      } else {
        groupRef.current.position.set(...threePosition);
      }
    }

    if (borderMeshRef.current) {
      const borderPosition = osrsToThreePosition(adjustedPosition, -0.002);
      borderMeshRef.current.position.set(...borderPosition);
    }

    if (config.debug && debugTextRef.current) {
      debugTextRef.current.text = `Render: ${groupRef.current.position.x.toFixed(2)}, ${-groupRef.current.position.z.toFixed(2)}`;
    }
  });

  if (entity.type !== EntityType.NPC) {
    console.warn('NPC component received non-NPC entity:', entity);
    return null;
  }

  const handleClick = () => {
    if (!isDimmed && entity.interactive && onClicked) {
      onClicked(entity);
    }
  };

  const textColor = isSelected
    ? SELECTED_COLOR.clone()
    : isHovered
      ? HOVERED_COLOR.clone()
      : new THREE.Color('#ffffff');

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
          userData={{ entityId: entity.getUniqueId() }}
        >
          <Suspense
            fallback={<NpcFallback width={spriteWidth} height={spriteHeight} />}
          >
            <NpcSpriteMesh
              spriteWidth={spriteWidth}
              spriteHeight={spriteHeight}
              isSelected={isSelected}
              isHovered={isHovered}
              isDimmed={isDimmed}
              npcEntity={npcEntity}
              setAspect={setAspect}
            />
          </Suspense>
        </group>

        {!isDimmed && (
          <>
            <Text
              position={[0, 1.5 + (entity.size - 1) * 0.5, 0]}
              fontSize={0.5}
              color={textColor}
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
          </>
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
              color={textColor}
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
