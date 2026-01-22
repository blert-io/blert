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

  /** Container width in px. */
  width?: number;

  /** Container height in px. */
  height?: number;

  /** Whether the map is in fullscreen mode. */
  isFullscreen?: boolean;
};

export default function Map({
  children,
  config = DEFAULT_REPLAY_CONFIG,
  onConfigChange,
  playing,
  mapDefinition,
  width = 704,
  height = 604,
  isFullscreen = false,
}: MapProps) {
  const replayTime = useRef(0);
  const [cameraResetFn, setCameraResetFn] = useState<(() => void) | null>(null);

  const referenceWidth = width;
  const referenceHeight = height;

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
      style={isFullscreen ? undefined : { width, height }}
    >
      <ReplayContext.Provider value={contextValue}>
        <EntityPositionProvider>{children}</EntityPositionProvider>
      </ReplayContext.Provider>
    </div>
  );
}
