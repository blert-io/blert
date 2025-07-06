'use client';

import { Coords } from '@blert/common';
import { Billboard, Plane, Text } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
// @ts-ignore
import { Text as TroikaText } from 'troika-three-text';

import { updateInterpolation, osrsToThreePosition } from './animation';
import HealthBar from './health-bar';
import { useReplayContext } from './replay-context';
import { EntityType, InterpolationState, PlayerEntity } from './types';

export interface PlayerComponentProps {
  /** Entity data for the player */
  entity: PlayerEntity;

  /** Color assigned to this player in the party */
  partyColor?: string;

  /** Callback when the player is clicked */
  onClicked?: (entity: PlayerEntity) => void;

  /** Callback when the player is hovered/unhovered */
  onHover?: (entity: PlayerEntity | null) => void;

  /** Whether this player is currently selected */
  isSelected?: boolean;

  /** Whether this player is currently hovered */
  isHovered?: boolean;
}

/**
 * Renders a colored icon representing the player with name and health bar.
 */
export default function Player({
  entity,
  partyColor = '#6366f1',
  onClicked,
  onHover,
  isSelected = false,
  isHovered = false,
}: PlayerComponentProps) {
  const groupRef = useRef<THREE.Group>(null);
  const borderMeshRef = useRef<THREE.Mesh>(null);

  const interpolationStateRef = useRef<InterpolationState | null>(null);
  const currentPositionRef = useRef<Coords | null>(null);
  const debugTextRef = useRef<TroikaText>(null);
  const { config, playing, mapDefinition } = useReplayContext();

  const playerEntity = entity as PlayerEntity;

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

    const threePosition = osrsToThreePosition(position, 0.5);
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

  const borderMaterial = useMemo(() => {
    const borderColor = new THREE.Color(partyColor);

    return new THREE.ShaderMaterial({
      uniforms: {
        thickness: { value: 0.01 },
        borderWidth: { value: 0.05 },
        borderColor: {
          value: new THREE.Vector4(
            borderColor.r,
            borderColor.g,
            borderColor.b,
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
  }, [partyColor]);

  if (entity.type !== EntityType.PLAYER) {
    console.warn('Player component received non-player entity:', entity);
    return null;
  }

  const handleClick = () => {
    if (entity.interactive && onClicked) {
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

  const getVisualState = () => {
    if (isSelected) {
      return {
        borderColor: '#5865f2',
        opacity: 1,
      };
    }
    if (isHovered) {
      return {
        borderColor: '#f59e0b',
        opacity: 0.8,
      };
    }
    return {
      borderColor: '#1f2937',
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
          onPointerOver={handlePointerOver}
          onPointerOut={handlePointerOut}
        >
          <Plane args={[0.8, 0.8]}>
            <meshBasicMaterial color={partyColor} transparent opacity={0.9} />
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
          color="#ffffff"
          anchorX="center"
          anchorY="middle"
          font="/fonts/runescape.ttf"
          outlineWidth={0.03}
          outlineColor="#000000"
        >
          {entity.name}
        </Text>

        {playerEntity.hitpoints && (
          <HealthBar
            hitpoints={playerEntity.hitpoints.current}
            nextHitpoints={playerEntity.hitpoints.next}
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
