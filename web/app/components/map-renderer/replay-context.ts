import { createContext, RefObject, useContext } from 'react';

import { TICK_MS } from '@/utils/tick';

import { MapDefinition, ReplayConfig } from './types';

export const DEFAULT_REPLAY_CONFIG: ReplayConfig = {
  interpolationEnabled: false,
  tickDuration: TICK_MS,
  debug: false,
};

type ReplayContextType = {
  config: Readonly<ReplayConfig>;
  updateConfig: (updater: (config: ReplayConfig) => ReplayConfig) => void;
  mapDefinition: Readonly<MapDefinition>;
  playing: Readonly<boolean>;
  replayTime: RefObject<number>;
  resetCamera: () => void;
  onResetAvailable: (resetFn: () => void) => void;
  referenceWidth: number | null;
  referenceHeight: number | null;
  isFullscreen: boolean;
};


export const ReplayContext = createContext<ReplayContextType>({
  config: DEFAULT_REPLAY_CONFIG,
  updateConfig: () => {
    /* noop */
  },
  playing: false,
  replayTime: { current: 0 },
  mapDefinition: {
    baseX: 0,
    baseY: 0,
    width: 0,
    height: 0,
  },
  resetCamera: () => {
    /* noop */
  },
  onResetAvailable: () => {
    /* noop */
  },
  referenceWidth: null,
  referenceHeight: null,
  isFullscreen: false,
});

export function useReplayContext(): ReplayContextType {
  const context = useContext(ReplayContext);
  if (!context) {
    throw new Error('useReplayContext must be used within a ReplayProvider');
  }
  return context;
}
