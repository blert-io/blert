import { Coords } from '@blert/common';
import { Billboard, useTexture } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { Ref, Suspense, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';

import { osrsToThreePosition } from './animation';
import { useEntityPositions } from './entity-position-context';
import {
  cycleToTick,
  isInterpolating,
  replayCycle,
  useReplayContext,
} from './replay-context';
import { CustomEntity, SpriteSheet } from './types';

export type SpriteFrame = {
  cell: number;
  cycles: number;
};

/**
 * Returns `count` consecutive frames starting at `first`,
 * each shown for `cycles` client cycles.
 */
export function spriteFrames(
  first: number,
  count: number,
  cycles: number,
): SpriteFrame[] {
  return Array.from({ length: count }, (_, i) => ({
    cell: first + i,
    cycles,
  }));
}

/**
 * Returns the cell an animation shows `cycle` client cycles after it starts,
 * or `undefined` before it starts and after it ends.
 */
export function cellAt(
  frames: SpriteFrame[],
  cycle: number,
): number | undefined {
  if (cycle < 0) {
    return undefined;
  }
  let end = 0;
  for (const frame of frames) {
    end += frame.cycles;
    if (cycle < end) {
      return frame.cell;
    }
  }
  return undefined;
}

type SheetSpriteProps = {
  sheet: SpriteSheet;
  texture: THREE.Texture;
  scale?: number;
  visible?: boolean;
  ref?: Ref<THREE.Mesh>;
};

/**
 * Draws a cell of a sprite sheet on an upright plane, with the sheet's anchor
 * at the plane's origin. The cell shown is set on the texture with `showCell`.
 * To lay the sprite on the ground, rotate its parent.
 */
export function SheetSprite({
  sheet,
  texture,
  scale = 1,
  visible = true,
  ref,
}: SheetSpriteProps) {
  const [offsetX, offsetY] = anchorOffset(sheet);
  return (
    <mesh
      ref={ref}
      visible={visible}
      position={[offsetX * scale, offsetY * scale, 0]}
      scale={[sheet.cellWidth * scale, sheet.cellHeight * scale, 1]}
    >
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial map={texture} transparent alphaTest={0.01} />
    </mesh>
  );
}

export function useSheetTexture(sheet: SpriteSheet): THREE.Texture {
  const loaded = useTexture(sheet.url);

  const texture = useMemo(() => {
    const clone = loaded.clone();
    clone.colorSpace = THREE.SRGBColorSpace;
    clone.minFilter = THREE.NearestFilter;
    clone.magFilter = THREE.NearestFilter;
    clone.repeat.set(1 / sheet.columns, 1 / sheet.rows);
    return clone;
  }, [loaded, sheet]);

  useEffect(() => () => texture.dispose(), [texture]);

  return texture;
}

export function showCell(
  texture: THREE.Texture,
  sheet: SpriteSheet,
  cell: number,
) {
  texture.offset.set(
    (cell % sheet.columns) / sheet.columns,
    1 - (Math.floor(cell / sheet.columns) + 1) / sheet.rows,
  );
}

export function anchorOffset(sheet: SpriteSheet): [number, number] {
  return [
    (0.5 - sheet.anchorX) * sheet.cellWidth,
    (sheet.anchorY - 0.5) * sheet.cellHeight,
  ];
}

export type SpriteSheetAnimation = {
  sheet: SpriteSheet;
  frames: SpriteFrame[];
  /** When not interpolating, the frame to use for each tick. */
  staticFramesByTick: number[];
  layFlat: boolean;
  height: number;
};

export function spriteAnimationPlaysOnTick(
  tick: number,
  startCycle: number,
  animation: SpriteSheetAnimation,
): boolean {
  const cycles = animation.frames.reduce((sum, f) => sum + f.cycles, 0);
  return (
    cycleToTick(startCycle) <= tick &&
    tick <= cycleToTick(startCycle + cycles - 1)
  );
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

type SpriteAnimationEntityData = {
  position: Coords;
  animation: SpriteSheetAnimation;
  startCycle: number;
  scale: number;
  quarterTurns: number;
  followId: string | null;
  path: Coords[] | null;
};

export class SpriteAnimationEntity extends CustomEntity<SpriteAnimationEntityData> {
  constructor(
    position: Coords,
    animation: SpriteSheetAnimation,
    startCycle: number,
    uniqueId: string,
    {
      scale = 1,
      quarterTurns = 0,
      followId = null,
      path = null,
    }: {
      scale?: number;
      quarterTurns?: number;
      followId?: string | null;
      path?: Coords[] | null;
    } = {},
  ) {
    super(
      'Effect',
      1,
      SpriteAnimationEntityRenderer,
      { position, animation, startCycle, scale, quarterTurns, followId, path },
      uniqueId,
    );
  }
}

function SpriteAnimationEntityRenderer({
  entity,
}: {
  entity: CustomEntity<SpriteAnimationEntityData>;
}) {
  return (
    <Suspense fallback={null}>
      <SpriteAnimationEntitySprite entity={entity} />
    </Suspense>
  );
}

function SpriteAnimationEntitySprite({
  entity,
}: {
  entity: CustomEntity<SpriteAnimationEntityData>;
}) {
  const { animation, startCycle, scale, quarterTurns, followId, path } =
    entity.data;
  const { sheet, layFlat, height } = animation;
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
      : animation.staticFramesByTick[
          replay.currentTick - cycleToTick(startCycle)
        ];
    let position: Coords | undefined;
    if (path !== null) {
      position = pathPointAt(animation.frames, path, cycle);
    } else if (followId !== null) {
      position = positions.get(followId);
    } else {
      position = entity.data.position;
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

  return layFlat ? (
    <group ref={groupRef}>
      <group rotation={[-Math.PI / 2, 0, (quarterTurns * Math.PI) / 2]}>
        {sprite}
      </group>
    </group>
  ) : (
    <Billboard ref={groupRef}>{sprite}</Billboard>
  );
}
