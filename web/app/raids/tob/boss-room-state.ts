import { useEffect, useRef, useState } from 'react';

import { TICK_MS } from '../../utils/tick';

export const usePlayingState = (totalTicks: number) => {
  const [currentTick, updateTickOnPage] = useState(1);
  const [playing, setPlaying] = useState(false);

  const tickTimeout = useRef<number | undefined>(undefined);

  const clearTimeout = () => {
    window.clearTimeout(tickTimeout.current);
    tickTimeout.current = undefined;
  };

  useEffect(() => {
    if (playing === true) {
      if (currentTick < totalTicks) {
        tickTimeout.current = window.setTimeout(() => {
          updateTickOnPage(currentTick + 1);
        }, TICK_MS);
      } else {
        setPlaying(false);
        clearTimeout();
        updateTickOnPage(1);
      }
    } else {
      clearTimeout();
    }
  }, [currentTick, totalTicks, playing]);

  return {
    currentTick,
    updateTickOnPage,
    playing,
    setPlaying,
  };
};
