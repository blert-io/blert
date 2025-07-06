'use client';

import { useMemo, useRef, useState } from 'react';

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
};

export default function Map({
  children,
  config = DEFAULT_REPLAY_CONFIG,
  onConfigChange,
  playing,
  mapDefinition,
  width = '100%',
  height = '100%',
}: MapProps) {
  const replayTime = useRef(0);
  const [cameraResetFn, setCameraResetFn] = useState<(() => void) | null>(null);

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
    }),
    [
      config,
      onConfigChange,
      playing,
      mapDefinition,
      replayTime,
      cameraResetFn,
      setCameraResetFn,
    ],
  );

  return (
    <div className={styles.map} style={{ width, height }}>
      <ReplayContext.Provider value={contextValue}>
        {children}
      </ReplayContext.Provider>
    </div>
  );
}
