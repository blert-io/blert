import {
  Coords,
  TfaXarthBlastEvent,
  TfaXarthBombsEvent,
  TfaXarthCorpseLeakEvent,
  TfaXarthFiresEvent,
} from '@blert/common';
import { Billboard } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { Suspense, useRef } from 'react';
import * as THREE from 'three';

import {
  AnyEntity,
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
import {
  EnhancedRoomNpc,
  PlayerStateMap,
  RoomNpcMap,
} from '@/utils/boss-room-state';

type SpriteAnimation = {
  sheet: SpriteSheet;
  frames: SpriteFrame[];
  held: number[];
  ground: boolean;
  height: number;
};

const BIND_CHAINS_SHEET: SpriteSheet = {
  url: '/images/objects/xarth-bind-chains.webp',
  columns: 8,
  rows: 5,
  cellWidth: 1.6953,
  cellHeight: 1.8047,
  anchorX: 0.5023,
  anchorY: 0.5281,
};

const BIND_SHADOW_SHEET: SpriteSheet = {
  url: '/images/objects/xarth-bind-shadow.webp',
  columns: 5,
  rows: 3,
  cellWidth: 0.8906,
  cellHeight: 0.8906,
  anchorX: 0.5,
  anchorY: 0.5,
};

const BOMB_SHEET: SpriteSheet = {
  url: '/images/objects/xarth-skull.webp',
  columns: 8,
  rows: 3,
  cellWidth: 0.625,
  cellHeight: 1.3516,
  anchorX: 0.5,
  anchorY: 0.5607,
};

const BOMB_HIT_SHEET: SpriteSheet = {
  url: '/images/objects/xarth-skull-hit.webp',
  columns: 5,
  rows: 2,
  cellWidth: 0.7031,
  cellHeight: 1.2734,
  anchorX: 0.5,
  anchorY: 0.6012,
};

const BLAST_SHEET: SpriteSheet = {
  url: '/images/objects/xarth-blast.webp',
  columns: 5,
  rows: 4,
  cellWidth: 1.1641,
  cellHeight: 2.2188,
  anchorX: 0.4765,
  anchorY: 0.8275,
};

const FLAME_BLAST_SHEET: SpriteSheet = {
  url: '/images/objects/xarth-flame-blast.webp',
  columns: 5,
  rows: 5,
  cellWidth: 8.5625,
  cellHeight: 8.6406,
  anchorX: 0.4964,
  anchorY: 0.4991,
};

const FIRE_SHEET: SpriteSheet = {
  url: '/images/objects/xarth-fire.webp',
  columns: 4,
  rows: 3,
  cellWidth: 1.0703,
  cellHeight: 1.2344,
  anchorX: 0.4964,
  anchorY: 0.6899,
};

const ABSORB_CORPSE_FIRE_SHEET: SpriteSheet = {
  url: '/images/objects/xarth-absorb-corpse-fire.webp',
  columns: 6,
  rows: 4,
  cellWidth: 3.0781,
  cellHeight: 4.9297,
  anchorX: 0.5025,
  anchorY: 0.7876,
};

const CORPSE_ABSORBED_SHEET: SpriteSheet = {
  url: '/images/objects/xarth-corpse-absorbed.webp',
  columns: 5,
  rows: 3,
  cellWidth: 0.9062,
  cellHeight: 2.3125,
  anchorX: 0.569,
  anchorY: 1.1453,
};

const RUBBLE_SHEET: SpriteSheet = {
  url: '/images/objects/xarth-rubble.webp',
  columns: 5,
  rows: 5,
  cellWidth: 2.2891,
  cellHeight: 4.0703,
  anchorX: 0.4983,
  anchorY: 0.81,
};

const RUBBLE_FLAMES_SHEET: SpriteSheet = {
  url: '/images/objects/xarth-rubble-flames.webp',
  columns: 5,
  rows: 5,
  cellWidth: 2.3984,
  cellHeight: 4.5391,
  anchorX: 0.5049,
  anchorY: 0.9277,
};

const BIND_CHAINS: SpriteAnimation = {
  sheet: BIND_CHAINS_SHEET,
  frames: [...spriteFrames(0, 12, 3), ...spriteFrames(12, 27, 2)],
  held: [9, 23, 38],
  ground: false,
  height: 0.51,
};

const BIND_SHADOW: SpriteAnimation = {
  sheet: BIND_SHADOW_SHEET,
  frames: [5, 5, 5, 5, 5, 5, 7, 7, 7, 7, 9, 10, 13].map((cycles, cell) => ({
    cell,
    cycles,
  })),
  held: [5, 10, 12],
  ground: true,
  height: 0.01,
};
const BIND_SHADOW_START_CYCLE = 30;

const BOMB_FLIGHT_CYCLES = 60;
const BOMB_CYCLES_PER_CELL = 4;
const BOMB_LIFT = 1.2;
const BOMB_HEIGHT = 0.5;
const BOMB_HELD = [
  { cell: 7, progress: 0.5 },
  { cell: 15, progress: 1 },
];

const BOMB_HIT: SpriteAnimation = {
  sheet: BOMB_HIT_SHEET,
  frames: spriteFrames(0, 10, 3),
  held: [9],
  ground: false,
  height: 0,
};

const BLAST: SpriteAnimation = {
  sheet: BLAST_SHEET,
  frames: [...spriteFrames(0, 10, 2), ...spriteFrames(10, 10, 3)],
  held: [13],
  ground: false,
  height: 0.02,
};
const PARTIAL_BLAST_SCALE = 70 / 128;

const FLAME_BLAST: SpriteAnimation = {
  sheet: FLAME_BLAST_SHEET,
  frames: [
    { cell: 0, cycles: 60 },
    ...spriteFrames(1, 6, 3),
    ...spriteFrames(7, 18, 4),
  ],
  held: [0, 0, 9, 17, 24],
  ground: true,
  height: 0.03,
};
const FLAME_BLAST_START_CYCLE = -60;

const FIRE_FRAMES = [2, 3, 2, 3, 2, 3, 2, 3, 2, 3, 2, 3].map(
  (cycles, cell) => ({ cell, cycles }),
);
const FIRE_LOOP_CYCLES = FIRE_FRAMES.reduce((sum, f) => sum + f.cycles, 0);
const FIRE_HELD_CELL = 0;

const ABSORB_CORPSE_FIRE: SpriteAnimation = {
  sheet: ABSORB_CORPSE_FIRE_SHEET,
  frames: [...spriteFrames(0, 22, 8), { cell: 22, cycles: 4 }],
  held: [3],
  ground: false,
  height: 0,
};

const CORPSE_ABSORBED: SpriteAnimation = {
  sheet: CORPSE_ABSORBED_SHEET,
  frames: spriteFrames(0, 15, 4),
  held: [],
  ground: false,
  height: 0,
};

const CORPSE_ABSORBED_OFFSETS = [
  { forward: 0.08, right: 0 },
  { forward: 0.17, right: 0.08 },
  { forward: 0.25, right: 0.15 },
  { forward: 0.32, right: 0.19 },
  { forward: 0.37, right: 0.24 },
  { forward: 0.49, right: 0.39 },
  { forward: 0.64, right: 0.51 },
  { forward: 0.77, right: 0.59 },
  { forward: 0.89, right: 0.77 },
  { forward: 1.06, right: 0.86 },
  { forward: 1.19, right: 0.9 },
  { forward: 1.37, right: 0.78 },
  { forward: 1.52, right: 0.45 },
  { forward: 1.76, right: 0.2 },
  { forward: 1.99, right: -0.06 },
];

const RUBBLE_STANDING_CELL = 0;
const RUBBLE_COLLAPSE_FRAMES = spriteFrames(1, 24, 3);
const RUBBLE_COLLAPSE_HELD = [10, 20, 24];
const RUBBLE_FLAMES_FRAMES = spriteFrames(0, 25, 3);
const RUBBLE_FLAMES_HELD = [9, 19];
const RUBBLE_FLAMES_NUDGE = 0.01;

export const ENTITY_TEXTURES = [
  BIND_CHAINS_SHEET.url,
  BIND_SHADOW_SHEET.url,
  BOMB_SHEET.url,
  BOMB_HIT_SHEET.url,
  BLAST_SHEET.url,
  FLAME_BLAST_SHEET.url,
  FIRE_SHEET.url,
  ABSORB_CORPSE_FIRE_SHEET.url,
  CORPSE_ABSORBED_SHEET.url,
  RUBBLE_SHEET.url,
  RUBBLE_FLAMES_SHEET.url,
];

export function bindsOnTick(
  xarth: EnhancedRoomNpc,
  tick: number,
  playerState: PlayerStateMap,
  events: TfaXarthBombsEvent[],
): AnyEntity[] {
  return events.flatMap((event) => {
    const entities: AnyEntity[] = [];
    const { tiles, landingTick } = event.tfaXarthBombs;
    const bindCycle = event.tick * CYCLES_PER_TICK;
    const shadowCycle = bindCycle + BIND_SHADOW_START_CYCLE;
    const landingCycle = landingTick * CYCLES_PER_TICK;
    const launchCycle = landingCycle - BOMB_FLIGHT_CYCLES;

    if (playsOnTick(tick, bindCycle, BIND_CHAINS)) {
      for (const [username, player] of playerState) {
        const state = player.stateByTick[event.tick] ?? null;
        if (state === null || state.isDead) {
          continue;
        }
        entities.push(
          new SpriteEffect(
            { x: state.xCoord, y: state.yCoord },
            BIND_CHAINS,
            bindCycle,
            `chains-${event.tick}-${username}`,
            { followId: PlayerEntity.uniqueId(username) },
          ),
        );
      }
    }

    const source = centerOf(xarth, event.tick);

    for (const tile of tiles) {
      const key = `${event.tick}-${tile.x}-${tile.y}`;
      if (playsOnTick(tick, shadowCycle, BIND_SHADOW)) {
        entities.push(
          new SpriteEffect(tile, BIND_SHADOW, shadowCycle, `shadow-${key}`),
        );
      }
      if (
        source !== null &&
        activeOnTick(tick, launchCycle, BOMB_FLIGHT_CYCLES)
      ) {
        entities.push(new XarthBomb(source, tile, launchCycle, `bomb-${key}`));
      }
      if (playsOnTick(tick, landingCycle, BOMB_HIT)) {
        entities.push(
          new SpriteEffect(tile, BOMB_HIT, landingCycle, `bomb-hit-${key}`),
        );
      }
    }

    return entities;
  });
}

export function blastsOnTick(
  xarth: EnhancedRoomNpc,
  tick: number,
  events: TfaXarthBlastEvent[],
): AnyEntity[] {
  return events.flatMap((event) => {
    const center = centerOf(xarth, event.tick);
    if (center === null) {
      return [];
    }

    const entities: AnyEntity[] = [];
    const blastCycle = event.tick * CYCLES_PER_TICK;
    const flameBlastCycle = blastCycle + FLAME_BLAST_START_CYCLE;
    if (playsOnTick(tick, flameBlastCycle, FLAME_BLAST)) {
      entities.push(
        new SpriteEffect(
          center,
          FLAME_BLAST,
          flameBlastCycle,
          `flame-blast-${event.tick}`,
        ),
      );
    }

    const { full, partial } = event.tfaXarthBlast;
    const blasts = [
      ...full.map((tile) => ({ tile, scale: 1 })),
      ...partial.map((tile) => ({ tile, scale: PARTIAL_BLAST_SCALE })),
    ];
    for (const { tile, scale } of blasts) {
      const distance = Math.max(
        Math.abs(tile.x - center.x),
        Math.abs(tile.y - center.y),
      );
      const blastTileCycle = blastCycle + distance - 1;
      if (playsOnTick(tick, blastTileCycle, BLAST)) {
        entities.push(
          new SpriteEffect(
            tile,
            BLAST,
            blastTileCycle,
            `blast-${event.tick}-${tile.x}-${tile.y}`,
            { scale },
          ),
        );
      }
    }

    return entities;
  });
}

export function firesByTick(
  events: TfaXarthFiresEvent[],
  totalTicks: number,
): XarthFire[][] {
  const eventsByTick = Map.groupBy(events, (event) => event.tick);
  const fires = new Map<string, XarthFire>();
  const byTick: XarthFire[][] = [];

  for (let tick = 0; tick < totalTicks; tick++) {
    for (const { tfaXarthFires } of eventsByTick.get(tick) ?? []) {
      for (const tile of tfaXarthFires.removed) {
        fires.delete(`${tile.x}-${tile.y}`);
      }
      for (const tile of tfaXarthFires.added) {
        fires.set(`${tile.x}-${tile.y}`, new XarthFire(tile, tick));
      }
    }
    byTick.push([...fires.values()]);
  }

  return byTick;
}

export function corpseLeaksByTick(
  xarth: EnhancedRoomNpc,
  npcs: RoomNpcMap,
  events: TfaXarthCorpseLeakEvent[],
  totalTicks: number,
): SpriteEffect[][] {
  const byTick: SpriteEffect[][] = Array.from({ length: totalTicks }, () => []);

  for (const event of events) {
    const { roomId } = event.tfaXarthCorpseLeak;
    const leakCycle = event.tick * CYCLES_PER_TICK;
    const effects: SpriteEffect[] = [];

    const xarthCenter = centerOf(xarth, event.tick);
    if (xarthCenter !== null) {
      effects.push(
        new SpriteEffect(
          xarthCenter,
          ABSORB_CORPSE_FIRE,
          leakCycle,
          `absorb-corpse-fire-${roomId}`,
          { followId: NpcEntity.uniqueId(xarth.roomId) },
        ),
      );
    }

    const corpse = npcs.get(roomId) ?? null;
    const corpseCenter = corpse === null ? null : centerOf(corpse, event.tick);
    if (xarthCenter !== null && corpseCenter !== null) {
      const dx = xarthCenter.x - corpseCenter.x;
      const dy = xarthCenter.y - corpseCenter.y;
      const length = Math.hypot(dx, dy);
      const forward = { x: dx / length, y: dy / length };
      const right = { x: forward.y, y: -forward.x };
      const path = CORPSE_ABSORBED_OFFSETS.map((offset) => ({
        x: corpseCenter.x + offset.forward * forward.x + offset.right * right.x,
        y: corpseCenter.y + offset.forward * forward.y + offset.right * right.y,
      }));
      effects.push(
        new SpriteEffect(
          corpseCenter,
          CORPSE_ABSORBED,
          leakCycle,
          `corpse-absorbed-${roomId}`,
          { path },
        ),
      );
    }

    for (const effect of effects) {
      const { animation, startCycle } = effect.data;
      const endCycle =
        startCycle + animation.frames.reduce((sum, f) => sum + f.cycles, 0);
      for (
        let tick = startTickOf(startCycle);
        tick < totalTicks && tick * CYCLES_PER_TICK < endCycle;
        tick++
      ) {
        byTick[tick].push(effect);
      }
    }
  }

  return byTick;
}

function startTickOf(startCycle: number): number {
  return Math.floor(startCycle / CYCLES_PER_TICK);
}

function activeOnTick(
  tick: number,
  startCycle: number,
  cycles: number,
): boolean {
  return (
    tick >= startTickOf(startCycle) &&
    tick * CYCLES_PER_TICK < startCycle + cycles
  );
}

function playsOnTick(
  tick: number,
  startCycle: number,
  animation: SpriteAnimation,
): boolean {
  const cycles = animation.frames.reduce((sum, f) => sum + f.cycles, 0);
  return activeOnTick(tick, startCycle, cycles);
}

function centerOf(npc: EnhancedRoomNpc, tick: number): Coords | null {
  const state = npc.stateByTick[tick] ?? null;
  if (state === null) {
    return null;
  }
  const offset = Math.floor(state.size / 2);
  return { x: state.position.x + offset, y: state.position.y + offset };
}

function pathPointAt(
  frames: SpriteFrame[],
  path: Coords[],
  cycle: number,
): Coords | undefined {
  if (cycle < 0) {
    return undefined;
  }
  let start = 0;
  for (let i = 0; i < frames.length; i++) {
    const end = start + frames[i].cycles;
    if (cycle < end) {
      const from = path[i];
      const to = i + 1 < path.length ? path[i + 1] : from;
      const t = (cycle - start) / frames[i].cycles;
      return {
        x: from.x + (to.x - from.x) * t,
        y: from.y + (to.y - from.y) * t,
      };
    }
    start = end;
  }
  return undefined;
}

type SpriteEffectData = {
  animation: SpriteAnimation;
  startCycle: number;
  scale: number;
  followId: string | null;
  path: Coords[] | null;
};

class SpriteEffect extends CustomEntity<SpriteEffectData> {
  constructor(
    position: Coords,
    animation: SpriteAnimation,
    startCycle: number,
    uniqueId: string,
    {
      scale = 1,
      followId = null,
      path = null,
    }: {
      scale?: number;
      followId?: string | null;
      path?: Coords[] | null;
    } = {},
  ) {
    super(
      position,
      'Effect',
      1,
      SpriteEffectRenderer,
      { animation, startCycle, scale, followId, path },
      uniqueId,
    );
  }
}

function SpriteEffectRenderer({
  entity,
}: {
  entity: CustomEntity<SpriteEffectData>;
}) {
  return (
    <Suspense fallback={null}>
      <SpriteEffectSprite entity={entity} />
    </Suspense>
  );
}

function SpriteEffectSprite({
  entity,
}: {
  entity: CustomEntity<SpriteEffectData>;
}) {
  const { animation, startCycle, scale, followId, path } = entity.data;
  const { sheet, ground, height } = animation;
  const replay = useReplayContext();
  const texture = useSheetTexture(sheet);
  const { positions } = useEntityPositions();

  const groupRef = useRef<THREE.Group>(null);
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame(() => {
    const group = groupRef.current;
    const mesh = meshRef.current;
    if (group === null || mesh === null) {
      return;
    }

    const cycle = replayCycle(replay) - startCycle;
    const cell = isInterpolating(replay)
      ? cellAt(animation.frames, cycle)
      : animation.held[replay.currentTick - startTickOf(startCycle)];
    let position: Coords | undefined;
    if (path !== null) {
      position = pathPointAt(animation.frames, path, cycle);
    } else if (followId !== null) {
      position = positions.get(followId);
    } else {
      position = entity.position;
    }
    if (cell === undefined || position === undefined) {
      mesh.visible = false;
      return;
    }

    showCell(texture, sheet, cell);
    group.position.set(...osrsToThreePosition(position, height));
    mesh.visible = true;
  });

  const sprite = (
    <SheetSprite
      ref={meshRef}
      sheet={sheet}
      texture={texture}
      scale={scale}
      visible={false}
    />
  );

  return ground ? (
    <group ref={groupRef}>
      <group rotation={[-Math.PI / 2, 0, 0]}>{sprite}</group>
    </group>
  ) : (
    <Billboard ref={groupRef}>{sprite}</Billboard>
  );
}

type XarthBombData = {
  target: Coords;
  launchCycle: number;
};

class XarthBomb extends CustomEntity<XarthBombData> {
  constructor(
    source: Coords,
    target: Coords,
    launchCycle: number,
    uniqueId: string,
  ) {
    super(
      source,
      'Bomb',
      1,
      XarthBombRenderer,
      { target, launchCycle },
      uniqueId,
    );
  }
}

function XarthBombRenderer({
  entity,
}: {
  entity: CustomEntity<XarthBombData>;
}) {
  return (
    <Suspense fallback={null}>
      <XarthBombSprite entity={entity} />
    </Suspense>
  );
}

function XarthBombSprite({ entity }: { entity: CustomEntity<XarthBombData> }) {
  const { target, launchCycle } = entity.data;
  const replay = useReplayContext();
  const texture = useSheetTexture(BOMB_SHEET);

  const groupRef = useRef<THREE.Group>(null);
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame(() => {
    const group = groupRef.current;
    const mesh = meshRef.current;
    if (group === null || mesh === null) {
      return;
    }

    let cell: number | undefined;
    let flight: number | undefined;
    if (!isInterpolating(replay)) {
      ({ cell, progress: flight } =
        BOMB_HELD[replay.currentTick - startTickOf(launchCycle)] ?? {});
    } else {
      const cycle = replayCycle(replay) - launchCycle;
      if (cycle >= 0 && cycle <= BOMB_FLIGHT_CYCLES) {
        cell =
          Math.floor(cycle / BOMB_CYCLES_PER_CELL) %
          (BOMB_SHEET.columns * BOMB_SHEET.rows - 1);
        flight = cycle / BOMB_FLIGHT_CYCLES;
      }
    }

    if (cell === undefined || flight === undefined) {
      mesh.visible = false;
      return;
    }

    const source = entity.position;
    showCell(texture, BOMB_SHEET, cell);
    group.position.set(
      ...osrsToThreePosition(
        {
          x: source.x + (target.x - source.x) * flight,
          y: source.y + (target.y - source.y) * flight,
        },
        BOMB_HEIGHT + BOMB_LIFT * Math.sin(Math.PI * flight),
      ),
    );
    mesh.visible = true;
  });

  return (
    <Billboard ref={groupRef}>
      <SheetSprite
        ref={meshRef}
        sheet={BOMB_SHEET}
        texture={texture}
        visible={false}
      />
    </Billboard>
  );
}

type XarthFireData = {
  spawnTick: number;
};

class XarthFire extends CustomEntity<XarthFireData> {
  constructor(tile: Coords, spawnTick: number) {
    super(
      tile,
      'Fire',
      1,
      XarthFireRenderer,
      { spawnTick },
      `fire-${spawnTick}-${tile.x}-${tile.y}`,
    );
  }
}

function XarthFireRenderer({
  entity,
}: {
  entity: CustomEntity<XarthFireData>;
}) {
  return (
    <Billboard position={osrsToThreePosition(entity.position, 0)}>
      <Suspense fallback={null}>
        <XarthFireSprite spawnTick={entity.data.spawnTick} />
      </Suspense>
    </Billboard>
  );
}

function XarthFireSprite({ spawnTick }: { spawnTick: number }) {
  const replay = useReplayContext();
  const texture = useSheetTexture(FIRE_SHEET);

  useFrame(() => {
    const cell = isInterpolating(replay)
      ? cellAt(
          FIRE_FRAMES,
          (replayCycle(replay) - spawnTick * CYCLES_PER_TICK) %
            FIRE_LOOP_CYCLES,
        )
      : FIRE_HELD_CELL;
    if (cell !== undefined) {
      showCell(texture, FIRE_SHEET, cell);
    }
  });

  return <SheetSprite sheet={FIRE_SHEET} texture={texture} />;
}

type XarthPillarData = {
  breakTick: number | null;
};

export class XarthPillar extends CustomEntity<XarthPillarData> {
  constructor(pillar: NpcEntity, breakTick: number, tick: number) {
    const offset = (pillar.size - 1) / 2;
    super(
      { x: pillar.position.x + offset, y: pillar.position.y + offset },
      'Rubble',
      pillar.size,
      XarthPillarRenderer,
      { breakTick: breakTick !== 0 && tick >= breakTick ? breakTick : null },
      `pillar-${pillar.roomId}`,
    );
  }
}

function XarthPillarRenderer({
  entity,
}: {
  entity: CustomEntity<XarthPillarData>;
}) {
  return (
    <Billboard position={osrsToThreePosition(entity.position, 0)}>
      <Suspense fallback={null}>
        <XarthPillarSprite data={entity.data} />
      </Suspense>
    </Billboard>
  );
}

function XarthPillarSprite({ data }: { data: XarthPillarData }) {
  const { breakTick } = data;
  const replay = useReplayContext();
  const rubbleTexture = useSheetTexture(RUBBLE_SHEET);
  const flamesTexture = useSheetTexture(RUBBLE_FLAMES_SHEET);

  const flamesRef = useRef<THREE.Mesh>(null);

  useFrame(() => {
    const flames = flamesRef.current;
    if (flames === null) {
      return;
    }

    if (breakTick === null) {
      showCell(rubbleTexture, RUBBLE_SHEET, RUBBLE_STANDING_CELL);
      flames.visible = false;
      return;
    }

    let rubbleCell: number;
    let flamesCell: number | undefined;
    if (isInterpolating(replay)) {
      const cycle = replayCycle(replay) - breakTick * CYCLES_PER_TICK;
      rubbleCell =
        cellAt(RUBBLE_COLLAPSE_FRAMES, cycle) ??
        RUBBLE_COLLAPSE_FRAMES[RUBBLE_COLLAPSE_FRAMES.length - 1].cell;
      flamesCell = cellAt(RUBBLE_FLAMES_FRAMES, cycle);
    } else {
      const ticksSinceBreak = replay.currentTick - breakTick;
      rubbleCell =
        RUBBLE_COLLAPSE_HELD[
          Math.min(ticksSinceBreak, RUBBLE_COLLAPSE_HELD.length - 1)
        ];
      flamesCell = RUBBLE_FLAMES_HELD[ticksSinceBreak];
    }

    showCell(rubbleTexture, RUBBLE_SHEET, rubbleCell);
    if (flamesCell === undefined) {
      flames.visible = false;
      return;
    }
    showCell(flamesTexture, RUBBLE_FLAMES_SHEET, flamesCell);
    flames.visible = true;
  });

  return (
    <>
      <SheetSprite sheet={RUBBLE_SHEET} texture={rubbleTexture} />
      <group position={[0, 0, RUBBLE_FLAMES_NUDGE]}>
        <SheetSprite
          ref={flamesRef}
          sheet={RUBBLE_FLAMES_SHEET}
          texture={flamesTexture}
          visible={false}
        />
      </group>
    </>
  );
}
