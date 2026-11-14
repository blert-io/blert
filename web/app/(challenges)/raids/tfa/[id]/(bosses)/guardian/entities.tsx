import {
  Coords,
  NpcAttack,
  TfaGuardianRocksEvent,
  TfaGuardianShroom,
  TfaGuardianShroomsEvent,
  TfaGuardianShroomState,
} from '@blert/common';
import { Billboard, Line, useTexture } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { ComponentRef, RefObject, Suspense, useRef } from 'react';
import * as THREE from 'three';

import {
  cellAt,
  CustomEntity,
  CYCLES_PER_TICK,
  isInterpolating,
  NpcEntity,
  osrsToThreePosition,
  PlayerEntity,
  replayCycle,
  SheetSprite,
  showCell,
  SpriteFrame,
  spriteFrames,
  SpriteSheet,
  useEntityPositions,
  useReplayContext,
  useSheetTexture,
} from '@/components/map-renderer';
import { EnhancedRoomNpc, PlayerStateMap } from '@/utils/boss-room-state';

const LEAP_BASE_CYCLES = 31;
const LEAP_CYCLES_PER_TILE = 1.74;
const LEAP_MAX_CYCLES = 60;

const ROCK_TEXTURE = '/images/tfa/guardian/rocks.png';
const ROCK_LAUNCH_CYCLE = 48;
const ROCK_FLIGHT_CYCLES = 68;
const ROCK_APEX_CYCLE = 22.6;
const ROCK_APEX_HEIGHT = 8.531;
const ROCK_CURVATURE = 0.0033;
const ROCK_FALL_CYCLE = 52;
const ROCK_FALL_HEIGHT = 5.68;
const ROCK_FALL_SPEED = 0.194;
const ROCK_LANDING_HEIGHT = 0.5;
const ROCK_HEIGHT_OFFSET =
  ROCK_LANDING_HEIGHT -
  (ROCK_FALL_HEIGHT - ROCK_FALL_SPEED * (ROCK_FLIGHT_CYCLES - ROCK_FALL_CYCLE));
const ROCK_WIDTH = 1.1;
const ROCK_TURNS_PER_TICK = 1;

type ShroomAnimation = {
  sheet: SpriteSheet;
  frames: SpriteFrame[];
  held: number[];
};

const SHROOM_SHEET: SpriteSheet = {
  url: '/images/objects/guardian-shroom.webp',
  columns: 6,
  rows: 6,
  cellWidth: 0.8672,
  cellHeight: 0.8906,
  anchorX: 0.5135,
  anchorY: 1,
};

const SHROOM_BURST_SHEET: SpriteSheet = {
  url: '/images/objects/guardian-shroom-burst.webp',
  columns: 9,
  rows: 2,
  cellWidth: 1.5938,
  cellHeight: 3.7031,
  anchorX: 0.5588,
  anchorY: 0.9515,
};

const SHROOM_ANIMATIONS: Record<TfaGuardianShroomState, ShroomAnimation> = {
  [TfaGuardianShroomState.SPAWNING]: {
    sheet: SHROOM_SHEET,
    frames: spriteFrames(0, 30, 3),
    held: [9, 19, 29],
  },
  [TfaGuardianShroomState.GROWN]: {
    sheet: SHROOM_SHEET,
    frames: spriteFrames(30, 1, 60),
    held: [30],
  },
  [TfaGuardianShroomState.POPPED]: {
    sheet: SHROOM_BURST_SHEET,
    frames: [...spriteFrames(0, 9, 4), ...spriteFrames(9, 8, 3)],
    held: [6],
  },
};

const BREATH_SHEET: SpriteSheet = {
  url: '/images/objects/guardian-breath.webp',
  columns: 5,
  rows: 1,
  cellWidth: 4.3125,
  cellHeight: 22.7188,
  anchorX: 0.4384,
  anchorY: 0.0014,
};
const BREATH_CYCLES_PER_CELL = 5;
const BREATH_HELD_CELL = 3;
const BREATH_HEIGHT = 0.02;

const BREATH_GLOW_SHEET: SpriteSheet = {
  url: '/images/objects/guardian-breath-glow.webp',
  columns: 8,
  rows: 4,
  cellWidth: 1.0314,
  cellHeight: 1.0416,
  anchorX: 0.5,
  anchorY: 0.5,
};
const BREATH_GLOW_START_CYCLE = 105;
const BREATH_GLOW_END_CYCLE = 260;
const BREATH_GLOW_CYCLES_PER_CELL = 5;
const BREATH_GLOW_HELD_CELLS = new Map([
  [4, 6],
  [5, 12],
  [6, 18],
  [7, 24],
  [8, 30],
]);
const BREATH_GLOW_HEIGHT = 2.15;
const BREATH_MOUTH_OFFSET = { x: -0.632, y: 0.434 };
const BREATH_GLOW_NUDGE = 0.05;

const BREATH_AIM_COLOR = '#ffaf3c';
const BREATH_AIM_OPACITY = 0.9;
const BREATH_AIM_HEIGHT = 0.02;
const BREATH_AIM_WIDTH = 2;
const BREATH_AIM_DASH = 0.5;
const BREATH_AIM_GAP = 0.3;
const BREATH_AIM_RING_RADIUS = 0.3;
const BREATH_AIM_RING_WIDTH = 0.05;
const BREATH_AIM_POINTS: [number, number, number][] = [
  [0, 0, 0],
  [0, 0, 0],
];

export const ENTITY_TEXTURES = [
  ROCK_TEXTURE,
  SHROOM_SHEET.url,
  SHROOM_BURST_SHEET.url,
  BREATH_SHEET.url,
  BREATH_GLOW_SHEET.url,
];

export function leapInterpolation(
  npc: EnhancedRoomNpc,
  tick: number,
): NpcEntity['options']['customInterpolation'] {
  const isLeap = (t: number) =>
    npc.stateByTick[t]?.attack?.attack === NpcAttack.TFA_GUARDIAN_LEAP;

  let leapTick: number;
  if (isLeap(tick + 1)) {
    leapTick = tick + 1;
  } else if (isLeap(tick)) {
    leapTick = tick;
  } else {
    return undefined;
  }

  const start = npc.stateByTick[leapTick - 1]?.position;
  const destination = npc.stateByTick[leapTick]?.position;
  if (start === undefined || destination === undefined) {
    return undefined;
  }

  const distance = Math.hypot(destination.x - start.x, destination.y - start.y);
  const cycles = Math.min(
    LEAP_MAX_CYCLES,
    LEAP_BASE_CYCLES + LEAP_CYCLES_PER_TILE * distance,
  );
  const firstTickFraction = CYCLES_PER_TICK / cycles;
  const partway = {
    x: start.x + (destination.x - start.x) * firstTickFraction,
    y: start.y + (destination.y - start.y) * firstTickFraction,
  };

  if (leapTick === tick + 1) {
    return { from: start, to: partway };
  }

  return {
    from: partway,
    to: destination,
    ease: (t) =>
      Math.min(1, (CYCLES_PER_TICK * t) / (cycles - CYCLES_PER_TICK)),
  };
}

export function guardianRocks(
  guardian: EnhancedRoomNpc,
  tick: number,
  events: TfaGuardianRocksEvent[],
): GuardianRock[] {
  return events.flatMap((event) => {
    const ticksSinceAuto = tick - event.tick;
    const tickStartCycle = ticksSinceAuto * CYCLES_PER_TICK - ROCK_LAUNCH_CYCLE;
    if (
      tickStartCycle + CYCLES_PER_TICK <= 0 ||
      tickStartCycle > ROCK_FLIGHT_CYCLES
    ) {
      return [];
    }

    const state = guardian.stateByTick[event.tick] ?? null;
    if (state === null) {
      return [];
    }

    const centerOffset = (state.size - 1) / 2;
    const source = {
      x: state.position.x + centerOffset,
      y: state.position.y + centerOffset,
    };
    return event.tfaGuardianRocks.targets.map(
      (target) =>
        new GuardianRock(
          source,
          PlayerEntity.uniqueId(target),
          ticksSinceAuto,
          `rock-${event.tick}-${target}`,
        ),
    );
  });
}

type GuardianRockData = {
  targetPlayerId: string;
  ticksSinceAuto: number;
};

class GuardianRock extends CustomEntity<GuardianRockData> {
  constructor(
    source: Coords,
    targetPlayerId: string,
    ticksSinceAuto: number,
    uniqueId: string,
  ) {
    super(
      source,
      'Rock',
      1,
      GuardianRockRenderer,
      { targetPlayerId, ticksSinceAuto },
      uniqueId,
    );
  }
}

const screenSource = new THREE.Vector3();
const screenTarget = new THREE.Vector3();

function GuardianRockRenderer({
  entity,
}: {
  entity: CustomEntity<GuardianRockData>;
}) {
  const replay = useReplayContext();
  const { positions } = useEntityPositions();

  const groupRef = useRef<THREE.Group>(null);
  const materialRef = useRef<THREE.SpriteMaterial>(null);

  useFrame(({ camera }) => {
    const group = groupRef.current;
    if (group === null) {
      return;
    }

    if (!isInterpolating(replay)) {
      group.visible = false;
      return;
    }

    const { targetPlayerId, ticksSinceAuto } = entity.data;
    const autoTick = replay.currentTick - ticksSinceAuto;
    const cycle =
      replayCycle(replay) - autoTick * CYCLES_PER_TICK - ROCK_LAUNCH_CYCLE;
    const target = positions.get(targetPlayerId);
    if (cycle < 0 || cycle > ROCK_FLIGHT_CYCLES || target === undefined) {
      group.visible = false;
      return;
    }

    const progress = cycle / ROCK_FLIGHT_CYCLES;
    const height =
      cycle <= ROCK_FALL_CYCLE
        ? ROCK_APEX_HEIGHT - ROCK_CURVATURE * (cycle - ROCK_APEX_CYCLE) ** 2
        : ROCK_FALL_HEIGHT - ROCK_FALL_SPEED * (cycle - ROCK_FALL_CYCLE);
    group.position.set(
      ...osrsToThreePosition(
        {
          x: entity.position.x + (target.x - entity.position.x) * progress,
          y: entity.position.y + (target.y - entity.position.y) * progress,
        },
        height + ROCK_HEIGHT_OFFSET,
      ),
    );
    group.visible = true;

    if (materialRef.current !== null) {
      screenSource.set(...osrsToThreePosition(entity.position)).project(camera);
      screenTarget.set(...osrsToThreePosition(target)).project(camera);
      const direction = screenTarget.x < screenSource.x ? 1 : -1;
      materialRef.current.rotation =
        direction *
        (cycle / CYCLES_PER_TICK) *
        ROCK_TURNS_PER_TICK *
        2 *
        Math.PI;
    }
  });

  return (
    <group ref={groupRef} visible={false}>
      <Suspense fallback={null}>
        <RockSprite materialRef={materialRef} />
      </Suspense>
    </group>
  );
}

function RockSprite({
  materialRef,
}: {
  materialRef: RefObject<THREE.SpriteMaterial | null>;
}) {
  const texture = useTexture(ROCK_TEXTURE);
  const { naturalWidth, naturalHeight } = texture.image as HTMLImageElement;

  return (
    <sprite
      scale={[ROCK_WIDTH, (ROCK_WIDTH * naturalHeight) / naturalWidth, 1]}
    >
      <spriteMaterial ref={materialRef} map={texture} transparent />
    </sprite>
  );
}

export function shroomsByTick(
  events: TfaGuardianShroomsEvent[],
  totalTicks: number,
): (TfaGuardianShroom & { ticksInState: number })[][] {
  const eventsByTick = Map.groupBy(events, (event) => event.tick);
  const shrooms = new Map<number, TfaGuardianShroom & { stateTick: number }>();
  const byTick: (TfaGuardianShroom & { ticksInState: number })[][] = [];

  for (let tick = 0; tick < totalTicks; tick++) {
    for (const { tfaGuardianShrooms } of eventsByTick.get(tick) ?? []) {
      for (const id of tfaGuardianShrooms.removed) {
        shrooms.delete(id);
      }
      for (const shroom of tfaGuardianShrooms.updated) {
        shrooms.set(shroom.id, { ...shroom, stateTick: tick });
      }
    }

    byTick.push(
      Array.from(shrooms.values(), ({ stateTick, ...shroom }) => ({
        ...shroom,
        ticksInState: tick - stateTick,
      })),
    );
  }

  return byTick;
}

type GuardianShroomData = {
  state: TfaGuardianShroomState;
  ticksInState: number;
};

export class GuardianShroom extends CustomEntity<GuardianShroomData> {
  constructor({
    id,
    position,
    state,
    ticksInState,
  }: TfaGuardianShroom & { ticksInState: number }) {
    super(
      position,
      'Shroom',
      1,
      GuardianShroomRenderer,
      { state, ticksInState },
      `shroom-${id}`,
    );
  }
}

function GuardianShroomRenderer({
  entity,
}: {
  entity: CustomEntity<GuardianShroomData>;
}) {
  return (
    <Billboard position={osrsToThreePosition(entity.position, 0)}>
      <Suspense fallback={null}>
        <ShroomSprite data={entity.data} />
      </Suspense>
    </Billboard>
  );
}

function ShroomSprite({ data }: { data: GuardianShroomData }) {
  const replay = useReplayContext();
  const shroomTexture = useSheetTexture(SHROOM_SHEET);
  const burstTexture = useSheetTexture(SHROOM_BURST_SHEET);

  const shroomRef = useRef<THREE.Mesh>(null);
  const burstRef = useRef<THREE.Mesh>(null);

  useFrame(() => {
    const shroom = shroomRef.current;
    const burst = burstRef.current;
    if (shroom === null || burst === null) {
      return;
    }

    const { state, ticksInState } = data;
    const { sheet, frames, held } = SHROOM_ANIMATIONS[state];
    const stateTick = replay.currentTick - ticksInState;
    const cell = isInterpolating(replay)
      ? (cellAt(frames, replayCycle(replay) - stateTick * CYCLES_PER_TICK) ??
        frames[frames.length - 1].cell)
      : held[Math.min(ticksInState, held.length - 1)];

    const bursting = sheet === SHROOM_BURST_SHEET;
    showCell(bursting ? burstTexture : shroomTexture, sheet, cell);
    shroom.visible = !bursting;
    burst.visible = bursting;
  });

  return (
    <>
      <SheetSprite
        ref={shroomRef}
        sheet={SHROOM_SHEET}
        texture={shroomTexture}
        visible={false}
      />
      <SheetSprite
        ref={burstRef}
        sheet={SHROOM_BURST_SHEET}
        texture={burstTexture}
        visible={false}
      />
    </>
  );
}

export type GuardianBreathAttack = {
  focusTick: number;
  focusEndTick: number;
  target: string;
  tile: Coords | null;
};

export function guardianBreaths(
  guardian: EnhancedRoomNpc,
  playerState: PlayerStateMap,
  totalTicks: number,
): GuardianBreathAttack[] {
  const endTick = guardian.dyingTick !== 0 ? guardian.dyingTick : totalTicks;
  const breaths: GuardianBreathAttack[] = [];
  let focusing: GuardianBreathAttack | null = null;

  for (const [tick, state] of guardian.stateByTick.entries()) {
    if (state?.attack?.target === undefined) {
      continue;
    }

    const { attack, target } = state.attack;
    if (attack === NpcAttack.TFA_GUARDIAN_BREATH_FOCUS) {
      focusing = { focusTick: tick, focusEndTick: endTick, target, tile: null };
      breaths.push(focusing);
    } else if (attack === NpcAttack.TFA_GUARDIAN_BREATH && focusing !== null) {
      const player = playerState.get(target)?.stateByTick[tick] ?? null;
      focusing.focusEndTick = tick;
      if (player !== null) {
        focusing.tile = { x: player.xCoord, y: player.yCoord };
      }
      focusing = null;
    }
  }

  return breaths;
}

export function breathsOnTick(
  guardian: EnhancedRoomNpc,
  tick: number,
  breaths: GuardianBreathAttack[],
): GuardianBreath[] {
  const state = guardian.stateByTick[tick] ?? null;
  if (state === null) {
    return [];
  }

  const centerOffset = (state.size - 1) / 2;
  const origin = {
    x: state.position.x + centerOffset,
    y: state.position.y + centerOffset,
  };
  return breaths
    .filter(
      ({ focusTick, focusEndTick, tile }) =>
        focusTick <= tick &&
        (tick < focusEndTick || (tick === focusEndTick && tile !== null)),
    )
    .map((breath) => new GuardianBreath(guardian.roomId, origin, breath, tick));
}

type GuardianBreathData = {
  guardianId: string;
  targetId: string;
  ticksSinceFocus: number;
  focusTicks: number;
  tile: Coords | null;
};

class GuardianBreath extends CustomEntity<GuardianBreathData> {
  constructor(
    guardianRoomId: number,
    origin: Coords,
    { focusTick, focusEndTick, target, tile }: GuardianBreathAttack,
    tick: number,
  ) {
    super(
      origin,
      'Breath',
      1,
      GuardianBreathRenderer,
      {
        guardianId: NpcEntity.uniqueId(guardianRoomId),
        targetId: PlayerEntity.uniqueId(target),
        ticksSinceFocus: tick - focusTick,
        focusTicks: focusEndTick - focusTick,
        tile,
      },
      `breath-${focusTick}`,
    );
  }
}

function GuardianBreathRenderer({
  entity,
}: {
  entity: CustomEntity<GuardianBreathData>;
}) {
  const { ticksSinceFocus, focusTicks, tile } = entity.data;
  if (tile === null || ticksSinceFocus < focusTicks) {
    return (
      <>
        <BreathAim data={entity.data} />
        <Suspense fallback={null}>
          <BreathGlow data={entity.data} />
        </Suspense>
      </>
    );
  }

  return (
    <Suspense fallback={null}>
      <BreathBeam origin={entity.position} tile={tile} />
    </Suspense>
  );
}

function BreathAim({ data }: { data: GuardianBreathData }) {
  const { positions } = useEntityPositions();

  const groupRef = useRef<THREE.Group>(null);
  const lineRef = useRef<ComponentRef<typeof Line>>(null);
  const ringRef = useRef<THREE.Mesh>(null);

  useFrame(() => {
    const group = groupRef.current;
    const line = lineRef.current;
    const ring = ringRef.current;
    if (group === null || line === null || ring === null) {
      return;
    }

    const guardian = positions.get(data.guardianId);
    const target = positions.get(data.targetId);
    if (guardian === undefined || target === undefined) {
      group.visible = false;
      return;
    }

    const from = osrsToThreePosition(guardian, BREATH_AIM_HEIGHT);
    const to = osrsToThreePosition(target, BREATH_AIM_HEIGHT);
    line.geometry.setPositions([...from, ...to]);
    line.computeLineDistances();
    ring.position.set(...to);
    group.visible = true;
  });

  return (
    <group ref={groupRef} visible={false}>
      <Line
        ref={lineRef}
        points={BREATH_AIM_POINTS}
        color={BREATH_AIM_COLOR}
        lineWidth={BREATH_AIM_WIDTH}
        dashed
        dashSize={BREATH_AIM_DASH}
        gapSize={BREATH_AIM_GAP}
        transparent
        opacity={BREATH_AIM_OPACITY}
      />
      <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry
          args={[
            BREATH_AIM_RING_RADIUS - BREATH_AIM_RING_WIDTH,
            BREATH_AIM_RING_RADIUS,
            32,
          ]}
        />
        <meshBasicMaterial
          color={BREATH_AIM_COLOR}
          transparent
          opacity={BREATH_AIM_OPACITY}
        />
      </mesh>
    </group>
  );
}

function BreathGlow({ data }: { data: GuardianBreathData }) {
  const replay = useReplayContext();
  const { positions } = useEntityPositions();
  const texture = useSheetTexture(BREATH_GLOW_SHEET);

  const groupRef = useRef<THREE.Group>(null);

  useFrame(() => {
    const group = groupRef.current;
    if (group === null) {
      return;
    }

    const { guardianId, ticksSinceFocus } = data;
    let cell: number | undefined;
    if (isInterpolating(replay)) {
      const focusTick = replay.currentTick - ticksSinceFocus;
      const cycle = replayCycle(replay) - focusTick * CYCLES_PER_TICK;
      if (cycle >= BREATH_GLOW_START_CYCLE && cycle < BREATH_GLOW_END_CYCLE) {
        cell = Math.floor(
          (cycle - BREATH_GLOW_START_CYCLE) / BREATH_GLOW_CYCLES_PER_CELL,
        );
      }
    } else {
      cell = BREATH_GLOW_HELD_CELLS.get(ticksSinceFocus);
    }

    const guardian = positions.get(guardianId);
    if (cell === undefined || guardian === undefined) {
      group.visible = false;
      return;
    }

    showCell(texture, BREATH_GLOW_SHEET, cell);
    group.position.set(...osrsToThreePosition(guardian, BREATH_GLOW_HEIGHT));
    group.visible = true;
  });

  return (
    <Billboard ref={groupRef} visible={false}>
      <group
        position={[
          BREATH_MOUTH_OFFSET.x,
          BREATH_MOUTH_OFFSET.y,
          BREATH_GLOW_NUDGE,
        ]}
      >
        <SheetSprite sheet={BREATH_GLOW_SHEET} texture={texture} />
      </group>
    </Billboard>
  );
}

function BreathBeam({ origin, tile }: { origin: Coords; tile: Coords }) {
  const replay = useReplayContext();
  const texture = useSheetTexture(BREATH_SHEET);

  const meshRef = useRef<THREE.Mesh>(null);

  useFrame(() => {
    const mesh = meshRef.current;
    if (mesh === null) {
      return;
    }

    let cell: number | undefined;
    if (isInterpolating(replay)) {
      const cycle = replayCycle(replay) - replay.currentTick * CYCLES_PER_TICK;
      const index = Math.floor(cycle / BREATH_CYCLES_PER_CELL);
      if (index < BREATH_SHEET.columns * BREATH_SHEET.rows) {
        cell = index;
      }
    } else {
      cell = BREATH_HELD_CELL;
    }

    if (cell === undefined) {
      mesh.visible = false;
      return;
    }

    showCell(texture, BREATH_SHEET, cell);
    mesh.visible = true;
  });

  const angle = Math.atan2(tile.x - origin.x, origin.y - tile.y);

  return (
    <group
      position={osrsToThreePosition(origin, BREATH_HEIGHT)}
      rotation={[0, angle, 0]}
    >
      <group rotation={[-Math.PI / 2, 0, 0]}>
        <SheetSprite
          ref={meshRef}
          sheet={BREATH_SHEET}
          texture={texture}
          visible={false}
        />
      </group>
    </group>
  );
}
