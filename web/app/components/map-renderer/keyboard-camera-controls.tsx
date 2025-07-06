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

    if (moveForward === 0 && moveRight === 0) {
      return;
    }

    let moveSpeed = speed * delta;
    if (KEY_BINDINGS.sprint.some((k) => keysRef.current[k])) {
      moveSpeed *= 2;
    }

    const length = Math.sqrt(moveForward * moveForward + moveRight * moveRight);
    const normForward = length > 0 ? moveForward / length : 0;
    const normRight = length > 0 ? moveRight / length : 0;

    camera.getWorldDirection(cameraDir.current);
    forwardVec.current
      .set(cameraDir.current.x, 0, cameraDir.current.z)
      .normalize();
    rightVec.current
      .crossVectors(forwardVec.current, new THREE.Vector3(0, 1, 0))
      .normalize();

    movementVec.current.set(0, 0, 0);
    movementVec.current
      .addScaledVector(forwardVec.current, normForward * moveSpeed)
      .addScaledVector(rightVec.current, normRight * moveSpeed);

    camera.position.add(movementVec.current);

    mapControls.target.add(movementVec.current);
    mapControls.update();
  });

  return null;
}
