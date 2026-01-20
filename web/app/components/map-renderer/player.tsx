'use client';

import { Coords } from '@blert/common';
import { Billboard, Plane, Text } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
// @ts-expect-error - troika-three-text has no type declarations
import { Text as TroikaText } from 'troika-three-text';

import {
  updateInterpolation,
  osrsToThreePosition,
  calculateFanOutOffset,
  threeToOsrsPosition,
} from './animation';
import { useEntityPositions } from './entity-position-context';
import HealthBar from './health-bar';
import { useReplayContext } from './replay-context';
import {
  EntityType,
  InteractiveEntityProps,
  InterpolationState,
  PlayerEntity,
} from './types';

export interface PlayerComponentProps extends InteractiveEntityProps<PlayerEntity> {
  /** Color assigned to this player in the party */
  partyColor?: string;
}

/**
 * Renders a colored icon representing the player with name and health bar.
 */
export default function Player({
  entity,
  partyColor = '#6366f1',
  onClicked,
  isSelected = false,
  isHovered = false,
  isDimmed = false,
  fanOutIndex,
  stackSize,
}: PlayerComponentProps) {
  const groupRef = useRef<THREE.Group>(null);
  const borderMeshRef = useRef<THREE.Mesh>(null);

  const interpolationStateRef = useRef<InterpolationState | null>(null);
  const currentPositionRef = useRef<Coords | null>(null);
  const debugTextRef = useRef<TroikaText>(null);
  const { config, playing, mapDefinition } = useReplayContext();
  const { updateEntityPosition } = useEntityPositions();

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

    let finalPosition = basePosition;
    if (fanOutIndex !== undefined && stackSize > 1) {
      const offset = calculateFanOutOffset(fanOutIndex, stackSize);
      finalPosition = {
        x: basePosition.x + offset.x,
        y: basePosition.y + offset.y,
      };
    }

    const threePosition = osrsToThreePosition(finalPosition, 0.5);
    if (fanOutIndex !== undefined) {
      const targetPosition = new THREE.Vector3(...threePosition);
      groupRef.current.position.lerp(targetPosition, 0.1);
    } else {
      groupRef.current.position.set(...threePosition);
    }

    updateEntityPosition(
      entity.getUniqueId(),
      threeToOsrsPosition(threePosition),
    );

    if (borderMeshRef.current) {
      const borderPosition = osrsToThreePosition(finalPosition, -0.002);
      borderMeshRef.current.position.set(...borderPosition);
    }

    if (config.debug && debugTextRef.current) {
      (debugTextRef.current as { text: string }).text =
        `Render: ${finalPosition.x.toFixed(2)}, ${finalPosition.y.toFixed(2)}`;
    }
  });

  const [{ meshColor, meshOpacity }, borderMaterial] = useMemo(() => {
    const baseColor = new THREE.Color(partyColor);

    const borderShader = new THREE.ShaderMaterial({
      uniforms: {
        thickness: { value: 0.01 },
        borderWidth: { value: 0.05 },
        borderColor: {
          value: new THREE.Vector4(baseColor.r, baseColor.g, baseColor.b, 0.5),
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
        uniform float borderWidth;
        uniform vec4 borderColor;
        varying vec2 vUv;
        void main() {
          float edge = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
          if (edge < borderWidth) {
            gl_FragColor = borderColor;
          } else {
            discard;
          }
        }
      `,
      transparent: true,
      depthWrite: false,
    });

    if (isDimmed) {
      const luminance =
        baseColor.r * 0.299 + baseColor.g * 0.587 + baseColor.b * 0.114;
      const grayscale = new THREE.Color(luminance, luminance, luminance);
      return [
        {
          meshColor: grayscale.lerp(baseColor, 0.5),
          meshOpacity: 0.5,
        },
        borderShader,
      ];
    }

    return [{ meshColor: baseColor, meshOpacity: 0.9 }, borderShader];
  }, [partyColor, isDimmed]);

  if (entity.type !== EntityType.PLAYER) {
    console.warn('Player component received non-player entity:', entity);
    return null;
  }

  const handleClick = () => {
    if (!isDimmed && entity.interactive && onClicked) {
      onClicked(entity);
    }
  };

  const getVisualState = () => {
    if (isSelected) {
      return {
        borderColor: '#5865f2',
        textColor: '#5865f2',
        opacity: 1,
      };
    }
    if (isHovered) {
      return {
        borderColor: '#f59e0b',
        textColor: '#f59e0b',
        opacity: 0.8,
      };
    }
    return {
      borderColor: '#1f2937',
      textColor: '#ffffff',
      opacity: 0.8,
    };
  };

  const visualState = getVisualState();

  return (
    <>
      <mesh
        ref={borderMeshRef}
        scale={1}
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
          <Plane args={[0.8, 0.8]}>
            <meshBasicMaterial
              color={meshColor}
              transparent
              opacity={meshOpacity}
            />
          </Plane>
          <Plane args={[0.95, 0.95]} position={[0, 0, -0.001]}>
            <meshBasicMaterial
              color={visualState.borderColor}
              transparent
              opacity={visualState.opacity}
            />
          </Plane>
        </group>

        <Text
          position={[0, 1.2, 0]}
          fontSize={0.4}
          color={visualState.textColor}
          anchorX="center"
          anchorY="middle"
          font="/fonts/runescape.ttf"
          outlineWidth={0.03}
          outlineColor="#000000"
        >
          {entity.name}
        </Text>

        {entity.hitpoints && (
          <HealthBar
            hitpoints={entity.hitpoints.current}
            nextHitpoints={entity.hitpoints.next}
            width={2.0}
            height={0.25}
            position={[0, 0.8, 0]}
          />
        )}

        {config.debug && (
          <group>
            <Plane args={[3, 1.2]} position={[0, 2.1, 0]}>
              <meshBasicMaterial color="#000000" transparent opacity={0.8} />
            </Plane>

            <Text
              position={[0, 2.4, 0.001]}
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
              position={[0, 2.1, 0.001]}
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
              position={[0, 1.8, 0.001]}
              fontSize={0.16}
              color="#64748b"
              anchorX="center"
              anchorY="middle"
              font="/fonts/runescape.ttf"
              outlineWidth={0.02}
              outlineColor="#000000"
            >
              {entity.nextPosition
                ? `Next: ${entity.nextPosition.x}, ${entity.nextPosition.y}`
                : 'Next: N/A'}
            </Text>

            <Text
              position={[0, 1.6, 0.001]}
              fontSize={0.14}
              color={visualState.textColor}
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
