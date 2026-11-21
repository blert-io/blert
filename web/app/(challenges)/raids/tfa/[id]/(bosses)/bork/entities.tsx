import {
  Coords,
  NpcAttack,
  TfaBorkBombEvent,
  TfaBorkCannonAutoEvent,
  TfaBorkDustEvent,
  TfaBorkNapalmEvent,
} from '@blert/common';
import { Suspense } from 'react';

import {
  AnyEntity,
  CustomEntity,
  CYCLES_PER_TICK,
  cycleToTick,
  osrsToThreePosition,
  PlayerEntity,
  ProjectileDefinition,
  ProjectileEntity,
  projectilePlaysOnTick,
  SheetSprite,
  SpriteAnimationEntity,
  spriteAnimationPlaysOnTick,
  spriteFrames,
  SpriteSheet,
  SpriteSheetAnimation,
  useSheetTexture,
} from '@/components/map-renderer';
import {
  EnhancedRoomNpc,
  NpcState,
  PlayerStateMap,
} from '@/utils/boss-room-state';
import { hash } from '@/utils/math';

const DUST_SHEET: SpriteSheet = {
  url: '/images/objects/bork-dust.webp',
  columns: 5,
  rows: 3,
  cellWidth: 1.1016,
  cellHeight: 1.0625,
  anchorX: 0.4965,
  anchorY: 0.6544,
};

const NAPALM_FIRE_SHEET: SpriteSheet = {
  url: '/images/objects/bork-napalm-fire.webp',
  columns: 5,
  rows: 4,
  cellWidth: 1.3203,
  cellHeight: 2.3359,
  anchorX: 0.503,
  anchorY: 0.8495,
};

const NAPALM_SPLAT_SHEET: SpriteSheet = {
  url: '/images/objects/bork-napalm-splat.webp',
  columns: 4,
  rows: 3,
  cellWidth: 0.8203,
  cellHeight: 1.0391,
  anchorX: 0.5524,
  anchorY: 0.5038,
};

const NAPALM_TILE_SHEET: SpriteSheet = {
  url: '/images/objects/bork-napalm-tile.png',
  columns: 1,
  rows: 1,
  cellWidth: 1,
  cellHeight: 1,
  anchorX: 0.5,
  anchorY: 0.5,
};

const BOMB_SHADOW_SHEET: SpriteSheet = {
  url: '/images/objects/debris-shadow.webp',
  columns: 5,
  rows: 3,
  cellWidth: 0.8906,
  cellHeight: 0.8906,
  anchorX: 0.5,
  anchorY: 0.5,
};

const BORK_STUN_SHEET: SpriteSheet = {
  url: '/images/objects/bork-stun.webp',
  columns: 12,
  rows: 7,
  cellWidth: 1.1484,
  cellHeight: 1.0391,
  anchorX: 0.5034,
  anchorY: 0.4962,
};

const DUST: SpriteSheetAnimation = {
  sheet: DUST_SHEET,
  frames: [...spriteFrames(0, 8, 4), ...spriteFrames(8, 7, 2)],
  staticFramesByTick: [3],
  layFlat: false,
  height: 0,
};

const NAPALM_FIRE: SpriteSheetAnimation = {
  sheet: NAPALM_FIRE_SHEET,
  frames: spriteFrames(0, 20, 3),
  staticFramesByTick: [5],
  layFlat: false,
  height: 0,
};

const NAPALM_SPLAT: SpriteSheetAnimation = {
  sheet: NAPALM_SPLAT_SHEET,
  frames: [3, 3, 3, 3, 3, 4, 4, 4, 5, 5, 6].map((cycles, cell) => ({
    cell,
    cycles,
  })),
  staticFramesByTick: [5],
  layFlat: true,
  height: 0.02,
};

const NAPALM_DESPAWN: SpriteSheetAnimation = {
  sheet: NAPALM_SPLAT_SHEET,
  frames: [6, 5, 5, 4, 4, 4, 3, 3, 3, 3, 3].map((cycles, i) => ({
    cell: 10 - i,
    cycles,
  })),
  staticFramesByTick: [8],
  layFlat: true,
  height: 0.02,
};

const NAPALM_TILE_HEIGHT = 0.01;

const BOMB_SHADOW: SpriteSheetAnimation = {
  sheet: BOMB_SHADOW_SHEET,
  frames: [5, 5, 5, 5, 5, 5, 7, 7, 7, 7, 9, 10, 73].map((cycles, cell) => ({
    cell,
    cycles,
  })),
  staticFramesByTick: [5, 10, 12, 12, 12],
  layFlat: true,
  height: 0.01,
};

export const BORK_STUN: SpriteSheetAnimation = {
  sheet: BORK_STUN_SHEET,
  frames: spriteFrames(0, 84, 5),
  staticFramesByTick: Array.from({ length: 14 }, (_, tick) => 6 * tick + 3),
  layFlat: false,
  height: 3.7,
};

const SMORKS_RANGED: ProjectileDefinition = {
  modelUrl: '/models/smorks-ranged.glb',
  startHeight: 270,
  endHeight: 100,
  slope: 20,
  startDistance: 100,
};

const SMORKS_MAGIC: ProjectileDefinition = {
  modelUrl: '/models/smorks-magic.glb',
  startHeight: 270,
  endHeight: 100,
  slope: 20,
  startDistance: 100,
};

const CANNON_AUTOS = new Map([
  [NpcAttack.TFA_SMORKS_RANGE, SMORKS_RANGED],
  [NpcAttack.TFA_SMORKS_MAGE, SMORKS_MAGIC],
]);

const CANNONBALL: ProjectileDefinition = {
  modelUrl: '/models/smorks-cannonball.glb',
  startHeight: 270,
  endHeight: 0,
  slope: 30,
  startDistance: 100,
};
const CANNONBALL_LAUNCH_CYCLE = 15;

const SMORKS_NAPALM: ProjectileDefinition = {
  modelUrl: '/models/smorks-napalm.glb',
  startHeight: 270,
  endHeight: 0,
  slope: 30,
  startDistance: 100,
};
const NAPALM_FLIGHT_CYCLES = 120;

export const ENTITY_TEXTURES = [
  DUST_SHEET.url,
  NAPALM_FIRE_SHEET.url,
  NAPALM_SPLAT_SHEET.url,
  NAPALM_TILE_SHEET.url,
  BOMB_SHADOW_SHEET.url,
  BORK_STUN_SHEET.url,
];

export const ENTITY_MODELS = [
  CANNONBALL.modelUrl,
  SMORKS_MAGIC.modelUrl,
  SMORKS_NAPALM.modelUrl,
  SMORKS_RANGED.modelUrl,
];

export function dustByTick(
  events: TfaBorkDustEvent[],
  totalTicks: number,
): SpriteAnimationEntity[][] {
  const byTick: SpriteAnimationEntity[][] = Array.from(
    { length: totalTicks },
    () => [],
  );

  for (const event of events) {
    const startCycle = event.tick * CYCLES_PER_TICK;
    for (const tile of event.tfaBorkDust.tiles) {
      const dust = new SpriteAnimationEntity(
        tile,
        DUST,
        startCycle,
        `dust-${event.tick}-${tile.x}-${tile.y}`,
      );
      for (
        let tick = event.tick;
        tick < totalTicks && spriteAnimationPlaysOnTick(tick, startCycle, DUST);
        tick++
      ) {
        byTick[tick].push(dust);
      }
    }
  }

  return byTick;
}

export function napalmByTick(
  smorks: EnhancedRoomNpc | null,
  playerState: PlayerStateMap,
  events: TfaBorkNapalmEvent[],
  totalTicks: number,
): AnyEntity[][] {
  const eventsByTick = Map.groupBy(events, (event) => event.tick);
  const tiles = new Map<string, BorkNapalmTile>();
  const animations: SpriteAnimationEntity[] = [];
  const projectiles: ProjectileEntity[] = [];
  const byTick: AnyEntity[][] = [];

  for (let tick = 0; tick < totalTicks; tick++) {
    const startCycle = tick * CYCLES_PER_TICK;
    const tickEvents = eventsByTick.get(tick) ?? [];

    for (const { tfaBorkNapalm } of tickEvents) {
      for (const tile of tfaBorkNapalm.removed) {
        const key = `${tile.x}-${tile.y}`;
        tiles.delete(key);
        animations.push(
          new SpriteAnimationEntity(
            tile,
            NAPALM_DESPAWN,
            startCycle,
            `napalm-despawn-${tick}-${key}`,
            { quarterTurns: quarterTurnsAt(tile) },
          ),
        );
      }
    }

    byTick.push([...tiles.values()]);

    for (const { tfaBorkNapalm } of tickEvents) {
      for (const tile of tfaBorkNapalm.added) {
        const key = `${tile.x}-${tile.y}`;
        tiles.set(key, new BorkNapalmTile(tile, tick));
        animations.push(
          new SpriteAnimationEntity(
            tile,
            NAPALM_FIRE,
            startCycle,
            `napalm-fire-${tick}-${key}`,
          ),
          new SpriteAnimationEntity(
            tile,
            NAPALM_SPLAT,
            startCycle,
            `napalm-splat-${tick}-${key}`,
            { quarterTurns: quarterTurnsAt(tile) },
          ),
        );
      }
    }

    const state = smorks?.stateByTick[tick] ?? null;
    if (state?.attack?.attack === NpcAttack.TFA_SMORKS_NAPALM) {
      const { target } = state.attack;
      const player =
        target === undefined
          ? null
          : (playerState.get(target)?.stateByTick[tick - 1] ?? null);
      if (player !== null) {
        projectiles.push(
          new ProjectileEntity(
            { kind: 'tile', tile: centerOf(state) },
            { kind: 'tile', tile: { x: player.xCoord, y: player.yCoord } },
            SMORKS_NAPALM,
            startCycle,
            startCycle + NAPALM_FLIGHT_CYCLES,
            `napalm-projectile-${tick}`,
          ),
        );
      }
    }
  }

  for (const animation of animations) {
    const { startCycle } = animation.data;
    for (
      let tick = cycleToTick(startCycle);
      tick < totalTicks &&
      spriteAnimationPlaysOnTick(tick, startCycle, animation.data.animation);
      tick++
    ) {
      byTick[tick].push(animation);
    }
  }

  for (const projectile of projectiles) {
    const { startCycle, endCycle } = projectile.data;
    for (
      let tick = cycleToTick(startCycle);
      tick < totalTicks && projectilePlaysOnTick(tick, startCycle, endCycle);
      tick++
    ) {
      byTick[tick].push(projectile);
    }
  }

  return byTick;
}

export function cannonAutosByTick(
  smorks: EnhancedRoomNpc,
  events: TfaBorkCannonAutoEvent[],
  totalTicks: number,
): ProjectileEntity[][] {
  const byTick: ProjectileEntity[][] = Array.from(
    { length: totalTicks },
    () => [],
  );

  for (const event of events) {
    const state = smorks.stateByTick[event.tick] ?? null;
    const attack = state?.attack ?? null;
    if (state === null || attack === null) {
      continue;
    }
    const definition = CANNON_AUTOS.get(attack.attack);
    if (definition === undefined) {
      continue;
    }

    const { targets, landingTick } = event.tfaBorkCannonAuto;
    const startCycle = event.tick * CYCLES_PER_TICK;
    const endCycle = landingTick * CYCLES_PER_TICK;
    for (const target of targets) {
      const projectile = new ProjectileEntity(
        { kind: 'tile', tile: centerOf(state) },
        { kind: 'entity', id: PlayerEntity.uniqueId(target) },
        definition,
        startCycle,
        endCycle,
        `cannon-auto-${event.tick}-${target}`,
      );
      for (
        let tick = event.tick;
        tick < totalTicks && projectilePlaysOnTick(tick, startCycle, endCycle);
        tick++
      ) {
        byTick[tick].push(projectile);
      }
    }
  }

  return byTick;
}

export function bombsByTick(
  smorks: EnhancedRoomNpc,
  events: TfaBorkBombEvent[],
  totalTicks: number,
): AnyEntity[][] {
  const byTick: AnyEntity[][] = Array.from({ length: totalTicks }, () => []);

  for (const event of events) {
    const { target, landingTick } = event.tfaBorkBomb;
    const shadowCycle = event.tick * CYCLES_PER_TICK;
    const shadow = new SpriteAnimationEntity(
      target,
      BOMB_SHADOW,
      shadowCycle,
      `bomb-shadow-${event.tick}`,
    );
    for (
      let tick = event.tick;
      tick < totalTicks &&
      spriteAnimationPlaysOnTick(tick, shadowCycle, BOMB_SHADOW);
      tick++
    ) {
      byTick[tick].push(shadow);
    }

    const state = smorks.stateByTick[event.tick] ?? null;
    if (state === null) {
      continue;
    }

    const startCycle = event.tick * CYCLES_PER_TICK + CANNONBALL_LAUNCH_CYCLE;
    const endCycle = landingTick * CYCLES_PER_TICK;
    const cannonball = new ProjectileEntity(
      { kind: 'tile', tile: centerOf(state) },
      { kind: 'tile', tile: target },
      CANNONBALL,
      startCycle,
      endCycle,
      `cannonball-${event.tick}`,
    );
    for (
      let tick = cycleToTick(startCycle);
      tick < totalTicks && projectilePlaysOnTick(tick, startCycle, endCycle);
      tick++
    ) {
      byTick[tick].push(cannonball);
    }
  }

  return byTick;
}

function centerOf(state: NpcState): Coords {
  const offset = Math.floor(state.size / 2);
  return { x: state.position.x + offset, y: state.position.y + offset };
}

function quarterTurnsAt(tile: Coords): number {
  return Math.floor(hash(tile.x * 78.233 + tile.y * 37.719) * 4);
}

type BorkNapalmTileData = {
  tile: Coords;
  quarterTurns: number;
};

class BorkNapalmTile extends CustomEntity<BorkNapalmTileData> {
  constructor(tile: Coords, addedTick: number) {
    super(
      'Napalm',
      1,
      BorkNapalmTileRenderer,
      { tile, quarterTurns: quarterTurnsAt(tile) },
      `napalm-tile-${addedTick}-${tile.x}-${tile.y}`,
    );
  }
}

function BorkNapalmTileRenderer({
  entity,
}: {
  entity: CustomEntity<BorkNapalmTileData>;
}) {
  return (
    <group
      position={osrsToThreePosition(entity.data.tile, NAPALM_TILE_HEIGHT)}
      rotation={[-Math.PI / 2, 0, (entity.data.quarterTurns * Math.PI) / 2]}
    >
      <Suspense fallback={null}>
        <BorkNapalmTileSprite />
      </Suspense>
    </group>
  );
}

function BorkNapalmTileSprite() {
  const texture = useSheetTexture(NAPALM_TILE_SHEET);
  return <SheetSprite sheet={NAPALM_TILE_SHEET} texture={texture} />;
}
