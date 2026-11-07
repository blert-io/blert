import { useTexture } from '@react-three/drei';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';

import { SpriteSheet } from './types';

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
