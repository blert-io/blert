import { ChallengeMode, NYLOCAS_WAVES, Stage } from '@blert/common';
import { Coords } from '@blert/common/generated/event_pb';

export interface CoordsLike {
  x: number;
  y: number;
}

export interface AreaLike {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type CoordKey = `${number},${number}`;

export function coordKey({ x, y }: CoordsLike): CoordKey {
  return `${x},${y}`;
}

export function fromCoordKey(key: CoordKey): CoordsLike {
  const [x, y] = key.split(',').map(Number);
  return { x, y };
}

export function protoCoords({ x, y }: CoordsLike): Coords {
  const c = new Coords();
  c.setX(x);
  c.setY(y);
  return c;
}

export function coordsFromProto(c: Coords): CoordsLike {
  return { x: c.getX(), y: c.getY() };
}

export function coordsEqual(a: CoordsLike, b: CoordsLike): boolean {
  return a.x === b.x && a.y === b.y;
}

export function inArea(coords: CoordsLike, area: AreaLike): boolean {
  return (
    coords.x >= area.x &&
    coords.x < area.x + area.width &&
    coords.y >= area.y &&
    coords.y < area.y + area.height
  );
}

export function chebyshev(a: CoordsLike, b: CoordsLike): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

export function euclidean(a: CoordsLike, b: CoordsLike): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

// Tile to which players are teleported at the start of Sotetseg's maze.
export const SOTETSEG_OVERWORLD_MAZE_START_TILE = { x: 3274, y: 4307 };
export const SOTETSEG_ROOM_AREA = { x: 3271, y: 4304, width: 17, height: 30 };
export const SOTETSEG_UNDERWORLD_AREA = {
  x: 3354,
  y: 4309,
  width: 14,
  height: 22,
};

// Tiles within melee range of Verzik's fixed 3x3 P2 location.
export const VERZIK_P2_BOUNCEABLE_AREA = {
  x: 3166,
  y: 4312,
  width: 5,
  height: 5,
};
export const VERZIK_P2_CENTER_TILE = { x: 3168, y: 4314 };

// Tiles within Verzik's 7x7 P3 location during webs.
export const VERZIK_P3_WEBS_AREA = { x: 3165, y: 4309, width: 7, height: 7 };
export const VERZIK_P3_WEBS_CENTER_TILE = { x: 3168, y: 4312 };

// Tile to which players are teleported at the start of Colosseum's boss fight.
export const COLOSSEUM_BOSS_START_TILE = { x: 1825, y: 3103 };

export function isValidP2BounceDestination(coords: CoordsLike): boolean {
  const distance = chebyshev(coords, VERZIK_P2_CENTER_TILE);
  return distance === 5 || distance === 6;
}

export function isValidP3WebsPushDestination(coords: CoordsLike): boolean {
  return chebyshev(coords, VERZIK_P3_WEBS_CENTER_TILE) === 4;
}

const DEATH_AREAS_BY_STAGE: Partial<Record<Stage, AreaLike[]>> = {
  [Stage.TOB_MAIDEN]: [
    { x: 3166, y: 4433, width: 2, height: 1 },
    { x: 3166, y: 4460, width: 2, height: 1 },
  ],
  [Stage.TOB_BLOAT]: [
    { x: 3295, y: 4436, width: 2, height: 1 },
    { x: 3295, y: 4459, width: 2, height: 1 },
  ],
  [Stage.TOB_NYLOCAS]: [
    { x: 3290, y: 4240, width: 1, height: 1 },
    { x: 3301, y: 4240, width: 1, height: 1 },
    { x: 3287, y: 4243, width: 1, height: 1 },
    { x: 3304, y: 4243, width: 1, height: 1 },
    { x: 3287, y: 4254, width: 1, height: 1 },
    { x: 3304, y: 4254, width: 1, height: 1 },
    { x: 3290, y: 4257, width: 1, height: 1 },
    { x: 3301, y: 4257, width: 1, height: 1 },
  ],
  [Stage.TOB_SOTETSEG]: [
    { x: 3270, y: 4313, width: 1, height: 2 },
    { x: 3289, y: 4313, width: 1, height: 2 },
  ],
  [Stage.TOB_XARPUS]: [{ x: 3156, y: 4381, width: 2, height: 13 }],
  [Stage.TOB_VERZIK]: [
    { x: 3157, y: 4325, width: 5, height: 1 },
    { x: 3175, y: 4325, width: 5, height: 1 },
  ],
};

export function isInDeathArea(stage: Stage, coords: CoordsLike): boolean {
  return (
    DEATH_AREAS_BY_STAGE[stage]?.some((area) => inArea(coords, area)) ?? false
  );
}

export function isPrinceWave(wave: number): boolean {
  return wave === 10 || wave === 20 || wave === 30;
}

/**
 * Returns the natural stall duration for a given Nylocas wave.
 */
export function naturalStallForWave(
  mode: ChallengeMode,
  wave: number,
): number {
  if (mode === ChallengeMode.TOB_HARD && isPrinceWave(wave)) {
    return 16;
  }
  return NYLOCAS_WAVES[wave - 1].naturalStall;
}

/**
 * Returns the sum of natural stall durations for the Nylocas waves in
 * `[lastWave, wave)`.
 */
export function sumNaturalStalls(
  mode: ChallengeMode,
  lastWave: number,
  wave: number,
): number {
  let sum = 0;
  for (let w = lastWave; w < wave; w++) {
    sum += naturalStallForWave(mode, w);
  }
  return sum;
}
