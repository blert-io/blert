import { useTexture } from '@react-three/drei';
import { Ref, useEffect, useMemo } from 'react';
import * as THREE from 'three';

import { SpriteSheet } from './types';

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
