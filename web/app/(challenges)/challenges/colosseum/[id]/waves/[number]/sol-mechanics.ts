import {
  ColosseumSolDustEvent,
  ColosseumSolGrappleEvent,
  ColosseumSolLasersEvent,
  ColosseumSolPoolsEvent,
  Coords,
  EquipmentSlot,
  EventType,
  Npc,
  NpcAttackEvent,
  SolDustDirection,
  SolDustPattern,
  SolGrappleOutcome,
  SolLaserPhase,
  equipmentSlotName,
} from '@blert/common';
import { useCallback, useMemo } from 'react';

import { CustomEntity, ObjectEntity } from '@/components/map-renderer';
import { CustomState } from '@/components/attack-timeline';
import { CustomStateEntry } from '@/components/boss-page-attack-timeline';

import DustCloudRenderer, { DustCloudData } from './dust-cloud';
import LaserBeamRenderer, { LaserBeamData } from './laser-beam';
import SolPoolRenderer, { SolPoolData } from './sol-pool';
import {
  EventTickMap,
  EventTypeMap,
  RoomNpcMap,
} from '@/utils/boss-room-state';

const SOL_ARENA_MIN_X = 1818;
const SOL_ARENA_MIN_Y = 3100;
const SOL_ARENA_MAX_X = 1831;
const SOL_ARENA_MAX_Y = 3113;

const SOL_ARENA_CORNERS = new Set([
  '1818,3100',
  '1831,3100',
  '1818,3113',
  '1831,3113',
]);

function isArenaCorner(x: number, y: number): boolean {
  return SOL_ARENA_CORNERS.has(`${x},${y}`);
}

export function computeTridentDustTiles(
  solX: number,
  solY: number,
  pattern: SolDustPattern,
  direction: SolDustDirection,
): Coords[] {
  const tiles: Coords[] = [];
  const prongOffsets =
    pattern === SolDustPattern.TRIDENT_1 ? [1, 3] : [0, 2, 4];

  if (
    direction === SolDustDirection.WEST ||
    direction === SolDustDirection.EAST
  ) {
    const isWest = direction === SolDustDirection.WEST;
    const adjX = isWest ? solX - 1 : solX + 5;
    const startX = isWest ? solX - 2 : solX + 6;
    const endX = isWest ? SOL_ARENA_MIN_X : SOL_ARENA_MAX_X;
    const step = isWest ? -1 : 1;

    for (let dy = 0; dy < 5; dy++) {
      tiles.push({ x: adjX, y: solY + dy });
    }
    for (const dy of prongOffsets) {
      const y = solY + dy;
      for (let x = startX; isWest ? x >= endX : x <= endX; x += step) {
        if (!isArenaCorner(x, y)) {
          tiles.push({ x, y });
        }
      }
    }
  } else {
    const isNorth = direction === SolDustDirection.NORTH;
    const adjY = isNorth ? solY + 5 : solY - 1;
    const startY = isNorth ? solY + 6 : solY - 2;
    const endY = isNorth ? SOL_ARENA_MAX_Y : SOL_ARENA_MIN_Y;
    const step = isNorth ? 1 : -1;

    for (let dx = 0; dx < 5; dx++) {
      tiles.push({ x: solX + dx, y: adjY });
    }
    for (const dx of prongOffsets) {
      const x = solX + dx;
      for (let y = startY; isNorth ? y <= endY : y >= endY; y += step) {
        if (!isArenaCorner(x, y)) {
          tiles.push({ x, y });
        }
      }
    }
  }

  return tiles;
}

export function computeShieldDustTiles(
  solX: number,
  solY: number,
  pattern: SolDustPattern,
): Coords[] {
  const safeDistance = pattern === SolDustPattern.SHIELD_1 ? 2 : 3;
  const tiles: Coords[] = [];

  for (let x = SOL_ARENA_MIN_X; x <= SOL_ARENA_MAX_X; x++) {
    for (let y = SOL_ARENA_MIN_Y; y <= SOL_ARENA_MAX_Y; y++) {
      if (isArenaCorner(x, y)) {
        continue;
      }

      const dx = Math.max(solX - x, 0, x - (solX + 4));
      const dy = Math.max(solY - y, 0, y - (solY + 4));
      const dist = Math.max(dx, dy);

      if (dist === 0 || dist === safeDistance) {
        continue;
      }

      tiles.push({ x, y });
    }
  }

  return tiles;
}

export function computeDustTiles(
  solX: number,
  solY: number,
  pattern: SolDustPattern,
  direction?: SolDustDirection,
): Coords[] {
  if (
    pattern === SolDustPattern.SHIELD_1 ||
    pattern === SolDustPattern.SHIELD_2
  ) {
    return computeShieldDustTiles(solX, solY, pattern);
  }
  if (direction === undefined) {
    return [];
  }
  return computeTridentDustTiles(solX, solY, pattern, direction);
}

const GRAPPLE_STATES = {
  [EquipmentSlot.TORSO]: {
    label: "Sol Heredit: I'LL CRUSH YOUR BODY!",
    iconUrl: '/images/colosseum/grapple-torso.png',
  },
  [EquipmentSlot.CAPE]: {
    label: "Sol Heredit: I'LL BREAK YOUR BACK!",
    iconUrl: '/images/colosseum/grapple-cape.png',
  },
  [EquipmentSlot.GLOVES]: {
    label: "Sol Heredit: I'LL TWIST YOUR HANDS OFF!",
    iconUrl: '/images/colosseum/grapple-gloves.png',
  },
  [EquipmentSlot.LEGS]: {
    label: "Sol Heredit: I'LL BREAK YOUR LEGS!",
    iconUrl: '/images/colosseum/grapple-legs.png',
  },
  [EquipmentSlot.BOOTS]: {
    label: "Sol Heredit: I'LL CUT YOUR FEET OFF!",
    iconUrl: '/images/colosseum/grapple-boots.png',
  },
} as const;

export type SolHereditData = {
  customEntities: (tick: number) => (ObjectEntity | CustomEntity<any>)[];
  customStates: CustomStateEntry[];
};

export function useSolMechanics(
  eventsByType: EventTypeMap,
  eventsByTick: EventTickMap,
  npcState: RoomNpcMap,
  playerName: string | undefined,
): SolHereditData {
  const dustEntriesByTick = useMemo(() => {
    type DustTile = { coords: Coords; delay: number };
    type DustEntry = { tiles: DustTile[]; age: number };
    const map = new Map<number, DustEntry[]>();

    let solRoomId: number | null = null;
    for (const [roomId, npc] of npcState) {
      if (Npc.isSolHeredit(npc.spawnNpcId)) {
        solRoomId = roomId;
        break;
      }
    }
    if (solRoomId === null) {
      return map;
    }

    const sol = npcState.get(solRoomId)!;

    eventsByType[EventType.COLOSSEUM_SOL_DUST]?.forEach((event) => {
      const { pattern, direction } = (event as ColosseumSolDustEvent)
        .colosseumSolDust;
      const solState = sol.stateByTick[event.tick];
      if (!solState) {
        return;
      }

      const solX = solState.position.x;
      const solY = solState.position.y;

      const tiles = computeDustTiles(solX, solY, pattern, direction);

      let maxDist = 0;
      const distances = tiles.map((tile) => {
        const dx = Math.max(solX - tile.x, 0, tile.x - (solX + 4));
        const dy = Math.max(solY - tile.y, 0, tile.y - (solY + 4));
        const dist = Math.max(dx, dy);
        maxDist = Math.max(maxDist, dist);
        return dist;
      });

      const dustTiles: DustTile[] = tiles.map((tile, i) => ({
        coords: tile,
        delay: maxDist > 0 ? distances[i] / maxDist : 0,
      }));

      const appearTick = event.tick - 1;
      const fadeTick = event.tick;

      const appear = map.get(appearTick) ?? [];
      appear.push({ tiles: dustTiles, age: 0 });
      map.set(appearTick, appear);

      const fade = map.get(fadeTick) ?? [];
      fade.push({ tiles: dustTiles, age: 1 });
      map.set(fadeTick, fade);
    });

    return map;
  }, [eventsByType, npcState]);

  const poolSpawnTicks = useMemo(() => {
    const spawnTicks = new Map<string, number>();

    eventsByType[EventType.COLOSSEUM_SOL_POOLS]?.forEach((event) => {
      const { pools } = (event as ColosseumSolPoolsEvent).colosseumSolPools;
      for (const pool of pools) {
        spawnTicks.set(`${pool.x},${pool.y}`, event.tick);
      }
    });

    return spawnTicks;
  }, [eventsByType]);

  const laserBeamsByTick = useMemo(() => {
    type LaserCycle = { scanTick: number; shotTick: number | null };
    const cycles: LaserCycle[] = [];
    let currentCycle: LaserCycle | null = null;

    const events = eventsByType[EventType.COLOSSEUM_SOL_LASERS] ?? [];
    for (const event of events) {
      const { phase } = (event as ColosseumSolLasersEvent).colosseumSolLasers;

      if (phase === SolLaserPhase.SCAN) {
        currentCycle = { scanTick: event.tick, shotTick: null };
        cycles.push(currentCycle);
      } else if (phase === SolLaserPhase.SHOT && currentCycle !== null) {
        currentCycle.shotTick = event.tick;
        currentCycle = null;
      }
    }

    type PrismBeam = {
      axis: 'x' | 'y';
      fixedCoord: number;
      startVar: number;
      endVar: number;
      prismVar: number;
    };

    function prismBeamAtTick(roomId: number, tick: number): PrismBeam | null {
      const npc = npcState.get(roomId);
      if (npc === undefined) {
        return null;
      }
      const state = npc.stateByTick[tick];
      if (state === null || state === undefined) {
        return null;
      }

      const { x, y } = state.position;

      if (x <= SOL_ARENA_MIN_X) {
        return {
          axis: 'y',
          fixedCoord: y,
          startVar: x + 1,
          endVar: SOL_ARENA_MAX_X,
          prismVar: x,
        };
      } else if (x >= SOL_ARENA_MAX_X) {
        return {
          axis: 'y',
          fixedCoord: y,
          startVar: SOL_ARENA_MIN_X,
          endVar: x - 1,
          prismVar: x,
        };
      } else if (y <= SOL_ARENA_MIN_Y) {
        return {
          axis: 'x',
          fixedCoord: x,
          startVar: y + 1,
          endVar: SOL_ARENA_MAX_Y,
          prismVar: y,
        };
      } else if (y >= SOL_ARENA_MAX_Y) {
        return {
          axis: 'x',
          fixedCoord: x,
          startVar: SOL_ARENA_MIN_Y,
          endVar: y - 1,
          prismVar: y,
        };
      }
      return null;
    }

    const prismRoomIds: number[] = [];
    for (const [roomId, npc] of npcState) {
      if (Npc.isLaserPrism(npc.spawnNpcId)) {
        prismRoomIds.push(roomId);
      }
    }

    const RESIDUAL_TICKS = 2;
    const map = new Map<number, LaserBeamData[]>();

    for (const cycle of cycles) {
      const lastActiveTick = cycle.shotTick ?? cycle.scanTick;
      const endTick = lastActiveTick + RESIDUAL_TICKS;
      const scanDuration =
        cycle.shotTick !== null
          ? cycle.shotTick - cycle.scanTick
          : endTick - cycle.scanTick + 1;

      for (let tick = cycle.scanTick; tick <= endTick; tick++) {
        let phase: 'scan' | 'shot' | 'residual';
        let phaseAge: number;
        let phaseDuration: number;

        if (cycle.shotTick !== null && tick === cycle.shotTick) {
          phase = 'shot';
          phaseAge = 0;
          phaseDuration = 1;
        } else if (tick > lastActiveTick) {
          phase = 'residual';
          phaseAge = tick - lastActiveTick - 1;
          phaseDuration = RESIDUAL_TICKS;
        } else {
          phase = 'scan';
          phaseAge = tick - cycle.scanTick;
          phaseDuration = scanDuration;
        }

        const beams: LaserBeamData[] = [];

        for (const roomId of prismRoomIds) {
          const prism = prismBeamAtTick(roomId, cycle.scanTick);
          if (prism === null) {
            continue;
          }

          beams.push({
            axis: prism.axis,
            fixedCoord: prism.fixedCoord,
            startVar: prism.startVar,
            endVar: prism.endVar,
            prismVar: prism.prismVar,
            phase,
            phaseAge,
            phaseDuration,
            isFirstAppearance: tick === cycle.scanTick,
          });
        }

        if (beams.length > 0) {
          const existing = map.get(tick) ?? [];
          existing.push(...beams);
          map.set(tick, existing);
        }
      }
    }

    return map;
  }, [eventsByType, npcState]);

  const customEntities = useCallback(
    (tick: number): (ObjectEntity | CustomEntity<any>)[] => {
      const entities: (ObjectEntity | CustomEntity<any>)[] = [];

      // Dust clouds.
      const dustEntries = dustEntriesByTick.get(tick);
      if (dustEntries !== undefined) {
        for (const entry of dustEntries) {
          for (const tile of entry.tiles) {
            entities.push(
              new CustomEntity<DustCloudData>(
                tile.coords,
                'Dust',
                1,
                DustCloudRenderer,
                { age: entry.age, delay: tile.delay },
                `dust-${tile.coords.x}-${tile.coords.y}`,
              ),
            );
          }
        }
      }

      for (const [key, spawnTick] of poolSpawnTicks) {
        if (tick < spawnTick) {
          continue;
        }
        const [x, y] = key.split(',').map(Number);
        const age = tick - spawnTick;
        entities.push(
          new CustomEntity<SolPoolData>(
            { x, y },
            'Sol Pool',
            1,
            SolPoolRenderer,
            { settled: age >= 3, age },
            `sol-pool-${key}`,
          ),
        );
      }

      const laserBeams = laserBeamsByTick.get(tick);
      if (laserBeams !== undefined) {
        for (const beam of laserBeams) {
          const midVar = Math.floor((beam.startVar + beam.endVar) / 2);
          const position: Coords =
            beam.axis === 'x'
              ? { x: beam.fixedCoord, y: midVar }
              : { x: midVar, y: beam.fixedCoord };

          entities.push(
            new CustomEntity<LaserBeamData>(
              position,
              'Laser Beam',
              1,
              LaserBeamRenderer,
              beam,
              `laser-${beam.axis}-${beam.fixedCoord}`,
            ),
          );
        }
      }

      return entities;
    },
    [dustEntriesByTick, poolSpawnTicks, laserBeamsByTick],
  );

  const customStates = useMemo(() => {
    const items: CustomStateEntry[] = [];
    const playerStatesByTick = new Map<number, CustomState[]>();

    eventsByType[EventType.COLOSSEUM_SOL_GRAPPLE]?.forEach((event) => {
      const grapple = (event as ColosseumSolGrappleEvent).colosseumSolGrapple;
      const attack = eventsByTick[grapple.attackTick]?.find<NpcAttackEvent>(
        (e): e is NpcAttackEvent =>
          e.type === EventType.NPC_ATTACK && Npc.isSolHeredit(e.npc.id),
      );
      if (attack === undefined) {
        return;
      }

      const state = GRAPPLE_STATES[grapple.target];
      items.push({
        npcRoomId: attack.npc.roomId,
        tick: grapple.attackTick,
        states: [
          {
            label: equipmentSlotName(grapple.target),
            iconUrl: state.iconUrl,
            fullText: state.label,
          },
        ],
      });

      let outcomeState: CustomState;
      switch (grapple.outcome) {
        case SolGrappleOutcome.HIT:
          outcomeState = {
            label: 'Hit',
            iconUrl: '/images/colosseum/grapple-hit.png',
            fullText: `${playerName} was hit by Sol Heredit's grapple!`,
          };
          break;
        case SolGrappleOutcome.DEFEND:
          outcomeState = {
            label: 'Defend',
            iconUrl: '/images/colosseum/grapple-defend.png',
            fullText: `${playerName} defended against Sol Heredit's grapple!`,
          };
          break;
        case SolGrappleOutcome.PARRY:
          outcomeState = {
            label: 'Parry',
            iconUrl: '/images/colosseum/grapple-parry.png',
            fullText: `${playerName} parried Sol Heredit's grapple!`,
          };
          break;
      }

      const existing = playerStatesByTick.get(event.tick) ?? [];
      existing.push(outcomeState);
      playerStatesByTick.set(event.tick, existing);
    });

    for (const [tick, states] of playerStatesByTick.entries()) {
      items.push({ playerName, tick, states });
    }

    return items;
  }, [eventsByType, eventsByTick, playerName]);

  return { customEntities, customStates };
}
