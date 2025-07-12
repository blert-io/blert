import { Coords } from '@blert/common';
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';

import {
  CustomEntity,
  osrsToThreePosition,
  useReplayContext,
} from '@/components/map-renderer';

type MazeTileData = {
  active: boolean;
};

export default class MazeTileEntity extends CustomEntity<MazeTileData> {
  constructor(position: Coords, active: boolean) {
    super(
      position,
      'MazeTile',
      1,
      MazeTileRenderer,
      { active },
      `maze-tile-${position.x}-${position.y}`,
    );
  }
}

const ACTIVE_COLOR = new THREE.Color('#dc2626');
const INACTIVE_SQUARE_COLOR = new THREE.Color('#666666');
const INACTIVE_CIRCLE_COLOR = new THREE.Color('#888888');
const BLACK = new THREE.Color('#000000');

const useSquareWallGeometry = () =>
  useMemo(() => {
    const shape = new THREE.Shape();
    const outerEdge = 0.5;
    const innerEdge = outerEdge - 0.02;

    shape.moveTo(-outerEdge, -outerEdge);
    shape.lineTo(outerEdge, -outerEdge);
    shape.lineTo(outerEdge, outerEdge);
    shape.lineTo(-outerEdge, outerEdge);
    shape.lineTo(-outerEdge, -outerEdge);

    const hole = new THREE.Path();
    hole.moveTo(-innerEdge, -innerEdge);
    hole.lineTo(innerEdge, -innerEdge);
    hole.lineTo(innerEdge, innerEdge);
    hole.lineTo(-innerEdge, innerEdge);
    hole.lineTo(-innerEdge, -innerEdge);
    shape.holes.push(hole);

    return new THREE.ExtrudeGeometry(shape, {
      depth: 1,
      bevelEnabled: false,
    });
  }, []);

const useCircleWallGeometry = () =>
  useMemo(() => {
    const radius = 0.25;
    const thickness = 0.02;

    const shape = new THREE.Shape().absarc(
      0,
      0,
      radius + thickness / 2,
      0,
      Math.PI * 2,
      false,
    );
    const hole = new THREE.Path().absarc(
      0,
      0,
      radius - thickness / 2,
      0,
      Math.PI * 2,
      true,
    );
    shape.holes.push(hole);

    return new THREE.ExtrudeGeometry(shape, {
      depth: 1,
      bevelEnabled: false,
    });
  }, []);

function MazeTileWalls({
  active,
  playing,
}: {
  active: boolean;
  playing: boolean;
}) {
  const squareWallRef = useRef<THREE.Mesh>(null!);
  const circleWallRef = useRef<THREE.Mesh>(null!);
  const squareMaterialRef = useRef<THREE.MeshStandardMaterial>(null!);
  const circleMaterialRef = useRef<THREE.MeshStandardMaterial>(null!);

  const squareGeo = useSquareWallGeometry();
  const circleGeo = useCircleWallGeometry();

  const progress = useRef(active ? 1 : 0);
  const animationSpeed = 2.5;

  useFrame((_, delta) => {
    // If the replay is playing, animate the progress value towards the target.
    // Otherwise, snap it to the final state.
    if (playing) {
      const targetProgress = active ? 1.0 : 0.0;
      let currentProgress = progress.current;

      if (Math.abs(targetProgress - currentProgress) > 0.001) {
        const step = delta * animationSpeed;
        progress.current =
          currentProgress < targetProgress
            ? Math.min(targetProgress, currentProgress + step)
            : Math.max(targetProgress, currentProgress - step);
      }
    } else {
      progress.current = active ? 1 : 0;
    }

    const p = progress.current;
    const isAnimating = playing && active;

    squareMaterialRef.current.color.lerpColors(
      INACTIVE_SQUARE_COLOR,
      ACTIVE_COLOR,
      p,
    );
    circleMaterialRef.current.color.lerpColors(
      INACTIVE_CIRCLE_COLOR,
      ACTIVE_COLOR,
      p,
    );

    // The emissive property gives the active walls their glow.
    squareMaterialRef.current.emissive.lerpColors(BLACK, ACTIVE_COLOR, p);
    circleMaterialRef.current.emissive.lerpColors(BLACK, ACTIVE_COLOR, p);
    squareMaterialRef.current.emissiveIntensity = p * 0.7;
    circleMaterialRef.current.emissiveIntensity = p * 0.7;

    const opacity = 0.7 * p;
    squareMaterialRef.current.opacity = opacity;
    circleMaterialRef.current.opacity = opacity;
    squareMaterialRef.current.transparent = isAnimating || active;
    circleMaterialRef.current.transparent = isAnimating || active;

    const squareHeight = p * 0.05;
    const circleHeight = p * 0.1;

    // Use a very small minimum height to ensure flat borders are visible.
    squareWallRef.current.scale.z = Math.max(0.001, squareHeight);
    circleWallRef.current.scale.z = Math.max(0.001, circleHeight);
  });

  return (
    <group>
      <mesh ref={squareWallRef} geometry={squareGeo}>
        <meshStandardMaterial ref={squareMaterialRef} />
      </mesh>
      <mesh ref={circleWallRef} geometry={circleGeo}>
        <meshStandardMaterial ref={circleMaterialRef} />
      </mesh>
    </group>
  );
}

function MazeTileRenderer({ entity }: { entity: CustomEntity<MazeTileData> }) {
  const { playing } = useReplayContext();
  const position = osrsToThreePosition(entity.position, 0.0);

  return (
    <group position={position} rotation={[-Math.PI / 2, 0, 0]}>
      <MazeTileWalls active={entity.data.active} playing={playing} />
    </group>
  );
}
