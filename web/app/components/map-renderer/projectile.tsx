import { Coords } from '@blert/common';
import { useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { Suspense, useMemo, useRef } from 'react';
import * as THREE from 'three';

import { TICK_MS } from '@/utils/tick';

import { osrsToThreePosition } from './animation';
import { EntityPositions, useEntityPositions } from './entity-position-context';
import {
  CYCLES_PER_TICK,
  cycleToTick,
  isInterpolating,
  replayCycle,
  useReplayContext,
} from './replay-context';
import { CustomEntity } from './types';

export type ProjectileDefinition = {
  modelUrl: string;
  startHeight: number;
  endHeight: number;
  slope: number;
  startDistance: number;
};

export type ProjectileEndpoint =
  { kind: 'tile'; tile: Coords } | { kind: 'entity'; id: string };

export function projectilePlaysOnTick(
  tick: number,
  startCycle: number,
  endCycle: number,
): boolean {
  return cycleToTick(startCycle) <= tick && tick <= cycleToTick(endCycle);
}

type ProjectileEntityData = {
  source: ProjectileEndpoint;
  target: ProjectileEndpoint;
  definition: ProjectileDefinition;
  startCycle: number;
  endCycle: number;
};

export class ProjectileEntity extends CustomEntity<ProjectileEntityData> {
  constructor(
    source: ProjectileEndpoint,
    target: ProjectileEndpoint,
    definition: ProjectileDefinition,
    startCycle: number,
    endCycle: number,
    uniqueId: string,
  ) {
    super(
      'Projectile',
      1,
      ProjectileEntityRenderer,
      { source, target, definition, startCycle, endCycle },
      uniqueId,
    );
  }
}

const LOCAL_UNITS_PER_TILE = 128;
const SECONDS_PER_CYCLE = TICK_MS / CYCLES_PER_TICK / 1000;

type Flight = {
  cycle: number;
  position: Coords;
  height: number;
  verticalSpeed: number;
};

function endpointPosition(
  endpoint: ProjectileEndpoint,
  positions: EntityPositions,
): Coords | undefined {
  return endpoint.kind === 'tile' ? endpoint.tile : positions.get(endpoint.id);
}

function ProjectileEntityRenderer({
  entity,
}: {
  entity: CustomEntity<ProjectileEntityData>;
}) {
  return (
    <Suspense fallback={null}>
      <ProjectileModel entity={entity} />
    </Suspense>
  );
}

function ProjectileModel({
  entity,
}: {
  entity: CustomEntity<ProjectileEntityData>;
}) {
  const { source, target, definition, startCycle, endCycle } = entity.data;
  const { modelUrl, slope } = definition;
  const startHeight = definition.startHeight / LOCAL_UNITS_PER_TILE;
  const endHeight = definition.endHeight / LOCAL_UNITS_PER_TILE;
  const startDistance = definition.startDistance / LOCAL_UNITS_PER_TILE;
  const replay = useReplayContext();
  const { positions } = useEntityPositions();
  const { scene, animations } = useGLTF(modelUrl);

  const model = useMemo(() => scene.clone(), [scene]);

  const mixer = useMemo(() => {
    const mixer = new THREE.AnimationMixer(model);
    for (const clip of animations) {
      mixer.clipAction(clip).play();
    }
    return mixer;
  }, [model, animations]);

  const groupRef = useRef<THREE.Group>(null);
  const flightRef = useRef<Flight | null>(null);

  useFrame(() => {
    const group = groupRef.current;
    if (group === null) {
      return;
    }

    const cycle = replayCycle(replay);
    const to = endpointPosition(target, positions);
    if (
      !isInterpolating(replay) ||
      cycle < startCycle ||
      cycle >= endCycle + 1 ||
      to === undefined
    ) {
      group.visible = false;
      flightRef.current = null;
      return;
    }

    let flight = flightRef.current;
    if (flight === null || cycle < flight.cycle) {
      const from = endpointPosition(source, positions);
      if (from === undefined) {
        group.visible = false;
        return;
      }
      const distance = Math.hypot(to.x - from.x, to.y - from.y);
      const along = distance === 0 ? 0 : startDistance / distance;
      const start = {
        x: from.x + (to.x - from.x) * along,
        y: from.y + (to.y - from.y) * along,
      };
      const duration = endCycle + 1 - startCycle;
      const elapsed = cycle - startCycle;
      const speed = Math.hypot(to.x - start.x, to.y - start.y) / duration;
      const verticalSpeed = speed * Math.tan((slope * 2 * Math.PI) / 256);
      const verticalAcceleration =
        (2 * (endHeight - startHeight - duration * verticalSpeed)) /
        duration ** 2;
      flight = {
        cycle,
        position: {
          x: start.x + ((to.x - start.x) * elapsed) / duration,
          y: start.y + ((to.y - start.y) * elapsed) / duration,
        },
        height:
          startHeight +
          verticalSpeed * elapsed +
          (verticalAcceleration * elapsed ** 2) / 2,
        verticalSpeed: verticalSpeed + verticalAcceleration * elapsed,
      };
    } else {
      const delta = cycle - flight.cycle;
      const remaining = endCycle + 1 - flight.cycle;
      const verticalAcceleration =
        (2 * (endHeight - flight.height - remaining * flight.verticalSpeed)) /
        remaining ** 2;
      flight = {
        cycle,
        position: {
          x:
            flight.position.x +
            ((to.x - flight.position.x) * delta) / remaining,
          y:
            flight.position.y +
            ((to.y - flight.position.y) * delta) / remaining,
        },
        height:
          flight.height +
          flight.verticalSpeed * delta +
          (verticalAcceleration * delta ** 2) / 2,
        verticalSpeed: flight.verticalSpeed + verticalAcceleration * delta,
      };
    }
    flightRef.current = flight;

    const remaining = endCycle + 1 - cycle;
    const velocityX = (to.x - flight.position.x) / remaining;
    const velocityY = (to.y - flight.position.y) / remaining;
    group.position.set(...osrsToThreePosition(flight.position, flight.height));
    group.rotation.set(
      -Math.atan2(flight.verticalSpeed, Math.hypot(velocityX, velocityY)),
      Math.atan2(velocityX, -velocityY),
      0,
      'YXZ',
    );
    mixer.setTime((cycle - startCycle) * SECONDS_PER_CYCLE);
    group.visible = true;
  });

  return (
    <group ref={groupRef} visible={false}>
      <primitive object={model} />
    </group>
  );
}
