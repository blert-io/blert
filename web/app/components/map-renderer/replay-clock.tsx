'use client';

import { useFrame } from '@react-three/fiber';
import { useEffect, useRef } from 'react';

import { useReplayContext } from './replay-context';

type ReplayClockProps = {
  /** The current tick of the replay. */
  currentTick: number;
  /** Callback to advance to the next tick. */
  onTick: () => void;
};

/** Advances a tick timer based on Three.js's internal clock. */
export default function ReplayClock({ currentTick, onTick }: ReplayClockProps) {
  const { config, playing, replayTime } = useReplayContext();
  const lastTickTime = useRef<number | null>(null);

  const seekRef = useRef<{ hasSeeked: boolean; tick: number }>({
    hasSeeked: false,
    tick: currentTick,
  });

  const tickDuration = config.tickDuration;

  useEffect(() => {
    if (seekRef.current.tick !== currentTick) {
      seekRef.current = { hasSeeked: true, tick: currentTick };
    }
    replayTime.current = currentTick * tickDuration;
  }, [currentTick, tickDuration, replayTime]);

  useFrame((state, delta) => {
    const currentTime = state.clock.getElapsedTime() * 1000;

    // A manual seek (or any external change) has occurred.
    // Reset the timer to grant a full tick duration for the new tick.
    if (seekRef.current.hasSeeked) {
      lastTickTime.current = currentTime;
      seekRef.current.hasSeeked = false;
    }

    if (!playing) {
      // If paused, keep pushing the timer's start time forward so there isn't
      // a time gap when resuming playback.
      lastTickTime.current = currentTime;
      return;
    }

    replayTime.current += delta * 1000;

    if (lastTickTime.current === null) {
      lastTickTime.current = currentTime;
    }

    const elapsed = currentTime - lastTickTime.current;

    if (elapsed >= config.tickDuration) {
      seekRef.current.tick++;
      lastTickTime.current += config.tickDuration;
      onTick();
    }
  });

  return null;
}
