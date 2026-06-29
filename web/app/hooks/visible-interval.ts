import { useEffect, useRef } from 'react';

/**
 * Runs `callback` on an interval, but only while the document is visible.
 *
 * @param callback Work to perform on each tick.
 * @param intervalMs Interval between ticks, in milliseconds.
 */
export function useVisibleInterval(
  callback: () => void,
  intervalMs: number,
): void {
  const savedCallback = useRef(callback);
  savedCallback.current = callback;

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const tick = () => savedCallback.current();

    const start = () => {
      if (timer !== null) {
        return;
      }
      tick();
      timer = setInterval(tick, intervalMs);
    };

    const stop = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };

    const onVisibilityChange = () => {
      if (document.hidden) {
        stop();
      } else {
        start();
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    if (!document.hidden) {
      start();
    }

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [intervalMs]);
}
