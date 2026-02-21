'use client';

import { useThree, useFrame } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { MapControls } from 'three-stdlib';

const KEY_BINDINGS = {
  forward: ['w'],
  back: ['s'],
  left: ['a'],
  right: ['d'],
  rotateLeft: ['q'],
  rotateRight: ['e'],
  tiltDown: ['z'],
  tiltUp: ['x'],
  sprint: ['shift'],
};

function getMoveInput(keys: Record<string, boolean>) {
  let moveForward = 0,
    moveRight = 0;
  if (KEY_BINDINGS.forward.some((k) => keys[k])) {
    moveForward += 1;
  }
  if (KEY_BINDINGS.back.some((k) => keys[k])) {
    moveForward -= 1;
  }
  if (KEY_BINDINGS.right.some((k) => keys[k])) {
    moveRight += 1;
  }
  if (KEY_BINDINGS.left.some((k) => keys[k])) {
    moveRight -= 1;
  }
  return { moveForward, moveRight };
}

const ROTATE_SPEED = 1.5;
const UP = new THREE.Vector3(0, 1, 0);

export interface KeyboardCameraControlsProps {
  speed?: number;
  enabled?: boolean;
}

export default function KeyboardCameraControls({
  speed = 16,
  enabled = true,
}: KeyboardCameraControlsProps) {
  const { camera, controls } = useThree();
  const keysRef = useRef<Record<string, boolean>>({});

  const forwardVec = useRef(new THREE.Vector3());
  const rightVec = useRef(new THREE.Vector3());
  const cameraDir = useRef(new THREE.Vector3());
  const movementVec = useRef(new THREE.Vector3());
  const offsetVec = useRef(new THREE.Vector3());
  const sphericalRef = useRef(new THREE.Spherical());

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const down = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target instanceof HTMLElement && e.target.contentEditable === 'true')
      ) {
        return;
      }

      const key = e.key.toLowerCase();
      keysRef.current[key] = true;

      if (Object.values(KEY_BINDINGS).flat().includes(key)) {
        e.preventDefault();
      }
    };

    const up = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      keysRef.current[key] = false;
      if (Object.values(KEY_BINDINGS).flat().includes(key)) {
        e.preventDefault();
      }
    };

    document.addEventListener('keydown', down);
    document.addEventListener('keyup', up);
    return () => {
      document.removeEventListener('keydown', down);
      document.removeEventListener('keyup', up);
    };
  }, [enabled]);

  useFrame((_, delta) => {
    if (!enabled || !controls) {
      return;
    }

    const mapControls = controls as MapControls;
    const { moveForward, moveRight } = getMoveInput(keysRef.current);

    const rotateLeft = KEY_BINDINGS.rotateLeft.some((k) => keysRef.current[k]);
    const rotateRight = KEY_BINDINGS.rotateRight.some(
      (k) => keysRef.current[k],
    );
    const tiltDown = KEY_BINDINGS.tiltDown.some((k) => keysRef.current[k]);
    const tiltUp = KEY_BINDINGS.tiltUp.some((k) => keysRef.current[k]);

    const hasRotation = rotateLeft || rotateRight || tiltDown || tiltUp;

    if (moveForward === 0 && moveRight === 0 && !hasRotation) {
      return;
    }

    let moveSpeed = speed * delta;
    if (KEY_BINDINGS.sprint.some((k) => keysRef.current[k])) {
      moveSpeed *= 2;
    }

    if (hasRotation) {
      const offset = offsetVec.current
        .copy(camera.position)
        .sub(mapControls.target);
      const spherical = sphericalRef.current.setFromVector3(offset);

      if (rotateLeft || rotateRight) {
        const yawDir = (rotateLeft ? 1 : 0) + (rotateRight ? -1 : 0);
        spherical.theta += yawDir * ROTATE_SPEED * delta;
      }

      if (tiltDown || tiltUp) {
        const pitchDir = (tiltDown ? 1 : 0) + (tiltUp ? -1 : 0);
        const minPhi = mapControls.minPolarAngle + 0.01;
        const maxPhi = mapControls.maxPolarAngle - 0.01;
        spherical.phi = Math.max(
          minPhi,
          Math.min(maxPhi, spherical.phi + pitchDir * ROTATE_SPEED * delta),
        );
      }

      offset.setFromSpherical(spherical);
      camera.position.copy(mapControls.target).add(offset);
      mapControls.update();
    }

    if (moveForward !== 0 || moveRight !== 0) {
      const length = Math.sqrt(
        moveForward * moveForward + moveRight * moveRight,
      );
      const normForward = moveForward / length;
      const normRight = moveRight / length;

      camera.getWorldDirection(cameraDir.current);
      forwardVec.current
        .set(cameraDir.current.x, 0, cameraDir.current.z)
        .normalize();
      rightVec.current.crossVectors(forwardVec.current, UP).normalize();

      movementVec.current.set(0, 0, 0);
      movementVec.current
        .addScaledVector(forwardVec.current, normForward * moveSpeed)
        .addScaledVector(rightVec.current, normRight * moveSpeed);

      camera.position.add(movementVec.current);
      mapControls.target.add(movementVec.current);
      mapControls.update();
    }
  });

  return null;
}
