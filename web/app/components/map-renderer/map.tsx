'use client';

import { useMemo, useRef, useState } from 'react';

import { EntityPositionProvider } from './entity-position-context';
import { ReplayContext, DEFAULT_REPLAY_CONFIG } from './replay-context';
import { MapDefinition, ReplayConfig } from './types';

import styles from './style.module.scss';

export type MapProps = {
  /** Map components to render. Must contain at least a `MapCanvas`. */
  children: React.ReactNode;

  /** Replay configuration. */
  config?: ReplayConfig;

  /** Callback to update the replay configuration. */
  onConfigChange?: (config: ReplayConfig) => void;

  /** Map definition. */
  mapDefinition: MapDefinition;

  /** Whether the replay is currently playing. */
  playing: boolean;

  /** Container width. Defaults to 100%. */
  width?: string | number;

  /** Container height. Defaults to 100%. */
  height?: string | number;

  /** Whether the map is in fullscreen mode. */
  isFullscreen?: boolean;
};

function parseDimension(
  value: string | number | undefined,
  fallback: number,
): number {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    const match = value.match(/^(\d+(?:\.\d+)?)/);
    if (match) {
      return parseFloat(match[1]);
    }
  }
  return fallback;
}

export default function Map({
  children,
  config = DEFAULT_REPLAY_CONFIG,
  onConfigChange,
  playing,
  mapDefinition,
  width = '100%',
  height = '100%',
  isFullscreen = false,
}: MapProps) {
  const replayTime = useRef(0);
  const [cameraResetFn, setCameraResetFn] = useState<(() => void) | null>(null);

  const referenceWidth = parseDimension(width, 704);
  const referenceHeight = parseDimension(height, 604);

  const contextValue = useMemo(
    () => ({
      config,
      updateConfig: (updater: (config: ReplayConfig) => ReplayConfig) => {
        const newConfig = updater(config);
        onConfigChange?.(newConfig);
      },
      playing,
      mapDefinition,
      replayTime,
      resetCamera: () => {
        if (cameraResetFn) {
          cameraResetFn();
        }
      },
      onResetAvailable: (resetFn: () => void) => {
        setCameraResetFn(() => resetFn);
      },
      referenceWidth,
      referenceHeight,
      isFullscreen,
    }),
    [
      config,
      onConfigChange,
      playing,
      mapDefinition,
      replayTime,
      cameraResetFn,
      setCameraResetFn,
      referenceWidth,
      referenceHeight,
      isFullscreen,
    ],
  );

  return (
    <div
      className={`${styles.map} ${isFullscreen ? styles.fullscreen : ''}`}
      style={{ width, height }}
    >
      <ReplayContext.Provider value={contextValue}>
        <EntityPositionProvider>{children}</EntityPositionProvider>
      </ReplayContext.Provider>
    </div>
  );
}
