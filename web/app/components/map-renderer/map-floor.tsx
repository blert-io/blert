'use client';

import { useTexture } from '@react-three/drei';
import { Plane } from '@react-three/drei';
import { useMemo, Suspense } from 'react';
import * as THREE from 'three';

type BaseTile = {
  x: number;
  y: number;
  color: string;
};

export interface MapFloorProps {
  /** Base X coordinate of the map */
  baseX: number;

  /** Base Y coordinate of the map */
  baseY: number;

  /** Width of the map in tiles */
  width: number;

  /** Height of the map in tiles */
  height: number;

  /** Base tiles with custom colors */
  baseTiles?: BaseTile[];
}

const TILE_SIZE = 1;
const CHUNK_SIZE = 8;

const OSRS_MAP_ORIGIN_X = 1024;
const OSRS_MAP_ORIGIN_Y = 1216;

/**
 * Returns the URL to a 256x256 PNG of the OSRS map tile for a given 8x8 chunk.
 */
function getTileUrl(chunkX: number, chunkY: number) {
  const offsetX = OSRS_MAP_ORIGIN_X / CHUNK_SIZE;
  const offsetY = OSRS_MAP_ORIGIN_Y / CHUNK_SIZE;

  const ZOOM = 11;

  const x = chunkX - offsetX;
  const y = chunkY - offsetY;

  // TODO(frolv): Host this ourselves.
  return `https://raw.githubusercontent.com/Explv/osrs_map_tiles/refs/heads/master/0/${ZOOM}/${x}/${y}.png`;
}

function LoadedMapChunk({
  chunkX,
  chunkY,
}: {
  chunkX: number;
  chunkY: number;
}) {
  const tileUrl = getTileUrl(chunkX, chunkY);

  const texture = useTexture(tileUrl, (loadedTexture) => {
    loadedTexture.minFilter = THREE.NearestFilter;
    loadedTexture.magFilter = THREE.NearestFilter;
    loadedTexture.wrapS = THREE.ClampToEdgeWrapping;
    loadedTexture.wrapT = THREE.ClampToEdgeWrapping;
  });

  const position: [number, number, number] = [
    chunkX * CHUNK_SIZE + CHUNK_SIZE / 2,
    -0.01,
    -(chunkY * CHUNK_SIZE + CHUNK_SIZE / 2),
  ];

  return (
    <Plane
      args={[CHUNK_SIZE, CHUNK_SIZE]}
      position={position}
      rotation={[-Math.PI / 2, 0, 0]}
    >
      <meshBasicMaterial map={texture} />
    </Plane>
  );
}

function FallbackMapChunk({
  chunkX,
  chunkY,
}: {
  chunkX: number;
  chunkY: number;
}) {
  const fallbackTexture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(0, 0, 256, 256);

    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    for (let i = 0; i < 16; i++) {
      const pos = (i / 16) * 256;
      ctx.beginPath();
      ctx.moveTo(pos, 0);
      ctx.lineTo(pos, 256);
      ctx.moveTo(0, pos);
      ctx.lineTo(256, pos);
      ctx.stroke();
    }

    ctx.fillStyle = '#555';
    ctx.font = '12px Arial';
    ctx.fillText(`${chunkX},${chunkY}`, 10, 20);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;

    return texture;
  }, [chunkX, chunkY]);

  const position: [number, number, number] = [
    chunkX * CHUNK_SIZE + CHUNK_SIZE / 2,
    -0.01,
    -(chunkY * CHUNK_SIZE + CHUNK_SIZE / 2),
  ];

  return (
    <Plane
      args={[CHUNK_SIZE, CHUNK_SIZE]}
      position={position}
      rotation={[-Math.PI / 2, 0, 0]}
    >
      <meshBasicMaterial map={fallbackTexture} />
    </Plane>
  );
}

/**
 * Renders a single map chunk with texture loading and fallback.
 */
function MapChunk({ chunkX, chunkY }: { chunkX: number; chunkY: number }) {
  return (
    <Suspense fallback={<FallbackMapChunk chunkX={chunkX} chunkY={chunkY} />}>
      <LoadedMapChunk chunkX={chunkX} chunkY={chunkY} />
    </Suspense>
  );
}

/**
 * Renders a single colored base tile.
 */
function BaseTileRenderer({ tile }: { tile: BaseTile }) {
  const position: [number, number, number] = [tile.x, 0, -tile.y];

  return (
    <Plane
      args={[TILE_SIZE, TILE_SIZE]}
      position={position}
      rotation={[-Math.PI / 2, 0, 0]}
    >
      <meshBasicMaterial
        color={tile.color || '#4a5568'}
        transparent={true}
        opacity={0.8}
      />
    </Plane>
  );
}

export default function MapFloor({
  baseX,
  baseY,
  width,
  height,
  baseTiles = [],
}: MapFloorProps) {
  const chunks = useMemo(() => {
    const chunkList: Array<{ chunkX: number; chunkY: number }> = [];

    const startChunkX = Math.floor(baseX / CHUNK_SIZE);
    const endChunkX = Math.floor((baseX + width - 1) / CHUNK_SIZE);
    const startChunkY = Math.floor(baseY / CHUNK_SIZE);
    const endChunkY = Math.floor((baseY + height - 1) / CHUNK_SIZE);

    for (let chunkX = startChunkX; chunkX <= endChunkX; chunkX++) {
      for (let chunkY = startChunkY; chunkY <= endChunkY; chunkY++) {
        chunkList.push({ chunkX, chunkY });
      }
    }

    return chunkList;
  }, [baseX, baseY, width, height]);

  return (
    <group>
      {chunks.map(({ chunkX, chunkY }) => (
        <MapChunk
          key={`chunk-${chunkX}-${chunkY}`}
          chunkX={chunkX}
          chunkY={chunkY}
        />
      ))}
      {baseTiles.map((tile, index) => (
        <BaseTileRenderer
          key={`base-tile-${tile.x}-${tile.y}-${index}`}
          tile={tile}
        />
      ))}
    </group>
  );
}
