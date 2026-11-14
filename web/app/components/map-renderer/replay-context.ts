import { createContext, RefObject, useContext } from 'react';

import { TICK_MS } from '@/utils/tick';

import { MapDefinition, ReplayConfig } from './types';

/** Number of client cycles in a tick. */
export const CYCLES_PER_TICK = 30;

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
  currentTick: number;
  onTick: () => void;
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
  currentTick: 0,
  onTick: () => undefined,
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

/** Returns whether the replay is animating between ticks. */
export function isInterpolating({
  config,
  playing,
}: ReplayContextType): boolean {
  return playing && config.interpolationEnabled;
}

/**
 * Returns the replay's current position in client cycles from the start of the
 * stage. When the replay is not interpolating, this is the start of the current
 * tick.
 */
export function replayCycle(replay: ReplayContextType): number {
  const { config, currentTick, replayTime } = replay;
  if (!isInterpolating(replay)) {
    return currentTick * CYCLES_PER_TICK;
  }
  const progress = replayTime.current / config.tickDuration - currentTick;
  return (currentTick + Math.min(Math.max(progress, 0), 1)) * CYCLES_PER_TICK;
}
