'use client';

import { Coords } from '@blert/common';
import { Billboard, Plane, Text } from '@react-three/drei';
import { ThreeEvent } from '@react-three/fiber';
import { useRef, useState } from 'react';
import * as THREE from 'three';

import { useReplayContext } from './replay-context';

export interface TileHoverOverlayProps {
  /** Map base X coordinate */
  baseX: number;
  /** Map base Y coordinate */
  baseY: number;
  /** Map width */
  width: number;
  /** Map height */
  height: number;
}

export default function TileHoverOverlay({
  width,
  height,
  baseX,
  baseY,
}: TileHoverOverlayProps) {
  const highlighterRef = useRef<THREE.Mesh>(null);
  const debugGroupRef = useRef<THREE.Group>(null);
  const [hoveredTile, setHoveredTile] = useState<Coords | null>(null);
  const { config } = useReplayContext();

  const handlePointerMove = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();

    if (!highlighterRef.current) {
      return;
    }

    const { point } = event;
    const tileX = Math.floor(point.x);
    const tileY = Math.floor(-point.z);

    setHoveredTile({ x: tileX, y: tileY });

    highlighterRef.current.position.set(tileX + 0.5, 0.01, -(tileY + 0.5));
    highlighterRef.current.visible = true;

    if (config.debug && debugGroupRef.current) {
      debugGroupRef.current.position.set(tileX + 0.5, 0.5, -(tileY + 0.5));
      debugGroupRef.current.visible = true;
    }
  };

  const handlePointerOut = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    if (highlighterRef.current) {
      highlighterRef.current.visible = false;
    }
    if (debugGroupRef.current) {
      debugGroupRef.current.visible = false;
    }
    setHoveredTile(null);
  };

  const planeWidth = width;
  const planeHeight = height;
  const planePosition: [number, number, number] = [
    baseX + width / 2,
    0,
    -(baseY + height / 2),
  ];

  return (
    <group>
      <Plane
        ref={highlighterRef}
        args={[1, 1]}
        rotation={[-Math.PI / 2, 0, 0]}
        visible={false}
      >
        <meshStandardMaterial
          color="#87cff7"
          emissive="#87cff7"
          emissiveIntensity={0.5}
          transparent
          opacity={0.3}
        />
      </Plane>

      <Plane
        args={[planeWidth, planeHeight]}
        position={planePosition}
        rotation={[-Math.PI / 2, 0, 0]}
        onPointerMove={handlePointerMove}
        onPointerOut={handlePointerOut}
        visible={false}
      />

      <Billboard ref={debugGroupRef} visible={false}>
        <Plane args={[2, 0.6]} position={[0, 0.001, 0]}>
          <meshBasicMaterial color="#000000" transparent opacity={0.8} />
        </Plane>
        <Text
          position={[0, 0.002, 0.001]}
          fontSize={0.4}
          color="#ffffff"
          anchorX="center"
          anchorY="middle"
          font="/fonts/runescape.ttf"
          outlineWidth={0.02}
          outlineColor="#000000"
        >
          {hoveredTile && `(${hoveredTile.x}, ${hoveredTile.y})`}
        </Text>
      </Billboard>
    </group>
  );
}
