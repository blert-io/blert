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
  cycleToTick,
  isInterpolating,
  NpcEntity,
  osrsToThreePosition,
  PlayerEntity,
  ProjectileDefinition,
  ProjectileEntity,
  projectilePlaysOnTick,
  replayCycle,
  SheetSprite,
  showCell,
  SpriteAnimationEntity,
  spriteAnimationPlaysOnTick,
  spriteFrames,
  SpriteSheet,
  SpriteSheetAnimation,
  useReplayContext,
  useSheetTexture,
} from '@/components/map-renderer';
import {
  EnhancedRoomNpc,
  PlayerStateMap,
  RoomNpcMap,
} from '@/utils/boss-room-state';

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
  url: '/images/objects/debris-shadow.webp',
  columns: 5,
  rows: 3,
  cellWidth: 0.8906,
  cellHeight: 0.8906,
  anchorX: 0.5,
  anchorY: 0.5,
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

const BIND_CHAINS: SpriteSheetAnimation = {
  sheet: BIND_CHAINS_SHEET,
  frames: [...spriteFrames(0, 12, 3), ...spriteFrames(12, 27, 2)],
  staticFramesByTick: [9],
  layFlat: false,
  height: 0.51,
};

const BIND_SHADOW: SpriteSheetAnimation = {
  sheet: BIND_SHADOW_SHEET,
  frames: [5, 5, 5, 5, 5, 5, 7, 7, 7, 7, 9, 10, 13].map((cycles, cell) => ({
    cell,
    cycles,
  })),
  staticFramesByTick: [5, 10, 12],
  layFlat: true,
  height: 0.01,
};
const BIND_SHADOW_START_CYCLE = 30;

const BOMB_FLIGHT_CYCLES = 60;
const XARTH_BOMB: ProjectileDefinition = {
  modelUrl: '/models/xarth-skull.glb',
  startHeight: 470,
  endHeight: 0,
  slope: 30,
  startDistance: 128,
};

const BOMB_HIT: SpriteSheetAnimation = {
  sheet: BOMB_HIT_SHEET,
  frames: spriteFrames(0, 10, 3),
  staticFramesByTick: [9],
  layFlat: false,
  height: 0,
};

const BLAST: SpriteSheetAnimation = {
  sheet: BLAST_SHEET,
  frames: [...spriteFrames(0, 10, 2), ...spriteFrames(10, 10, 3)],
  staticFramesByTick: [13],
  layFlat: false,
  height: 0.02,
};
const PARTIAL_BLAST_SCALE = 70 / 128;

const FLAME_BLAST: SpriteSheetAnimation = {
  sheet: FLAME_BLAST_SHEET,
  frames: [
    { cell: 0, cycles: 60 },
    ...spriteFrames(1, 6, 3),
    ...spriteFrames(7, 18, 4),
  ],
  staticFramesByTick: [0, 0, 9, 17, 24],
  layFlat: true,
  height: 0.03,
};
const FLAME_BLAST_START_CYCLE = -60;

const FIRE_FRAMES = [2, 3, 2, 3, 2, 3, 2, 3, 2, 3, 2, 3].map(
  (cycles, cell) => ({ cell, cycles }),
);
const FIRE_LOOP_CYCLES = FIRE_FRAMES.reduce((sum, f) => sum + f.cycles, 0);
const FIRE_HELD_CELL = 0;

const ABSORB_CORPSE_FIRE: SpriteSheetAnimation = {
  sheet: ABSORB_CORPSE_FIRE_SHEET,
  frames: [...spriteFrames(0, 22, 8), { cell: 22, cycles: 4 }],
  staticFramesByTick: [3],
  layFlat: false,
  height: 0,
};

const CORPSE_ABSORBED: SpriteSheetAnimation = {
  sheet: CORPSE_ABSORBED_SHEET,
  frames: spriteFrames(0, 15, 4),
  staticFramesByTick: [],
  layFlat: false,
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
const RUBBLE_COLLAPSE_HELD = [10];
const RUBBLE_FLAMES_FRAMES = spriteFrames(0, 25, 3);
const RUBBLE_FLAMES_HELD = [9, 19];
const RUBBLE_FLAMES_NUDGE = 0.01;

export const ENTITY_TEXTURES = [
  BIND_CHAINS_SHEET.url,
  BIND_SHADOW_SHEET.url,
  BOMB_HIT_SHEET.url,
  BLAST_SHEET.url,
  FLAME_BLAST_SHEET.url,
  FIRE_SHEET.url,
  ABSORB_CORPSE_FIRE_SHEET.url,
  CORPSE_ABSORBED_SHEET.url,
  RUBBLE_SHEET.url,
  RUBBLE_FLAMES_SHEET.url,
];

export const ENTITY_MODELS = [XARTH_BOMB.modelUrl];

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

    if (spriteAnimationPlaysOnTick(tick, bindCycle, BIND_CHAINS)) {
      for (const [username, player] of playerState) {
        const state = player.stateByTick[event.tick] ?? null;
        if (state === null || state.isDead) {
          continue;
        }
        entities.push(
          new SpriteAnimationEntity(
            { x: state.xCoord, y: state.yCoord },
            BIND_CHAINS,
            bindCycle,
            `chains-${event.tick}-${username}`,
            { followId: PlayerEntity.uniqueId(username) },
          ),
        );
      }
    }

    for (const tile of tiles) {
      const key = `${event.tick}-${tile.x}-${tile.y}`;
      if (spriteAnimationPlaysOnTick(tick, shadowCycle, BIND_SHADOW)) {
        entities.push(
          new SpriteAnimationEntity(
            tile,
            BIND_SHADOW,
            shadowCycle,
            `shadow-${key}`,
          ),
        );
      }
      if (projectilePlaysOnTick(tick, launchCycle, landingCycle)) {
        entities.push(
          new ProjectileEntity(
            { kind: 'entity', id: NpcEntity.uniqueId(xarth.roomId) },
            { kind: 'tile', tile },
            XARTH_BOMB,
            launchCycle,
            landingCycle,
            `bomb-${key}`,
          ),
        );
      }
      if (spriteAnimationPlaysOnTick(tick, landingCycle, BOMB_HIT)) {
        entities.push(
          new SpriteAnimationEntity(
            tile,
            BOMB_HIT,
            landingCycle,
            `bomb-hit-${key}`,
          ),
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
    if (spriteAnimationPlaysOnTick(tick, flameBlastCycle, FLAME_BLAST)) {
      entities.push(
        new SpriteAnimationEntity(
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
      if (spriteAnimationPlaysOnTick(tick, blastTileCycle, BLAST)) {
        entities.push(
          new SpriteAnimationEntity(
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
): SpriteAnimationEntity[][] {
  const byTick: SpriteAnimationEntity[][] = Array.from(
    { length: totalTicks },
    () => [],
  );

  for (const event of events) {
    const { roomId } = event.tfaXarthCorpseLeak;
    const leakCycle = event.tick * CYCLES_PER_TICK;
    const effects: SpriteAnimationEntity[] = [];

    const xarthCenter = centerOf(xarth, event.tick);
    if (xarthCenter !== null) {
      effects.push(
        new SpriteAnimationEntity(
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
        new SpriteAnimationEntity(
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
      for (
        let tick = cycleToTick(startCycle);
        tick < totalTicks &&
        spriteAnimationPlaysOnTick(tick, startCycle, animation);
        tick++
      ) {
        byTick[tick].push(effect);
      }
    }
  }

  return byTick;
}

function centerOf(npc: EnhancedRoomNpc, tick: number): Coords | null {
  const state = npc.stateByTick[tick] ?? null;
  if (state === null) {
    return null;
  }
  const offset = Math.floor(state.size / 2);
  return { x: state.position.x + offset, y: state.position.y + offset };
}

type XarthFireData = {
  tile: Coords;
  spawnTick: number;
};

class XarthFire extends CustomEntity<XarthFireData> {
  constructor(tile: Coords, spawnTick: number) {
    super(
      'Fire',
      1,
      XarthFireRenderer,
      { tile, spawnTick },
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
    <Billboard position={osrsToThreePosition(entity.data.tile, 0)}>
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
  center: Coords;
  breakTick: number | null;
};

export class XarthPillar extends CustomEntity<XarthPillarData> {
  constructor(pillar: NpcEntity, breakTick: number, tick: number) {
    const offset = (pillar.size - 1) / 2;
    super(
      'Rubble',
      pillar.size,
      XarthPillarRenderer,
      {
        center: {
          x: pillar.position.x + offset,
          y: pillar.position.y + offset,
        },
        breakTick: breakTick !== 0 && tick >= breakTick ? breakTick : null,
      },
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
    <Billboard position={osrsToThreePosition(entity.data.center, 0)}>
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

  const rubbleRef = useRef<THREE.Mesh>(null);
  const flamesRef = useRef<THREE.Mesh>(null);

  useFrame(() => {
    const rubble = rubbleRef.current;
    const flames = flamesRef.current;
    if (rubble === null || flames === null) {
      return;
    }

    if (breakTick === null) {
      showCell(rubbleTexture, RUBBLE_SHEET, RUBBLE_STANDING_CELL);
      rubble.visible = true;
      flames.visible = false;
      return;
    }

    let rubbleCell: number | undefined;
    let flamesCell: number | undefined;
    if (isInterpolating(replay)) {
      const cycle = replayCycle(replay) - breakTick * CYCLES_PER_TICK;
      rubbleCell =
        cellAt(RUBBLE_COLLAPSE_FRAMES, cycle) ??
        RUBBLE_COLLAPSE_FRAMES[RUBBLE_COLLAPSE_FRAMES.length - 1].cell;
      flamesCell = cellAt(RUBBLE_FLAMES_FRAMES, cycle);
    } else {
      const ticksSinceBreak = replay.currentTick - breakTick;
      rubbleCell = RUBBLE_COLLAPSE_HELD[ticksSinceBreak];
      flamesCell = RUBBLE_FLAMES_HELD[ticksSinceBreak];
    }

    if (rubbleCell === undefined) {
      rubble.visible = false;
    } else {
      showCell(rubbleTexture, RUBBLE_SHEET, rubbleCell);
      rubble.visible = true;
    }
    if (flamesCell === undefined) {
      flames.visible = false;
      return;
    }
    showCell(flamesTexture, RUBBLE_FLAMES_SHEET, flamesCell);
    flames.visible = true;
  });

  return (
    <>
      <SheetSprite
        ref={rubbleRef}
        sheet={RUBBLE_SHEET}
        texture={rubbleTexture}
      />
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
