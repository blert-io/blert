import { formatDuration } from './time';

/** Milliseconds in an OSRS tick. */
export const TICK_MS: number = 600;

/**
 * Converts a number of ticks to a time string in the format `mm:ss.ds`.
 */
export function ticksToFormattedSeconds(ticks: number): string {
  // Track time in milliseconds to avoid floating point math.
  const milliseconds = ticks * TICK_MS;

  const seconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const paddedSeconds = String(seconds % 60).padStart(2, '0');
  const deciseconds = (milliseconds % 1000) / 100;

  return `${minutes}:${paddedSeconds}.${deciseconds}`;
}

/**
 * Converts a human-readable time string to a number of ticks. The string may
 * either be a "precise" in-game time string (e.g. "2:19.20") or an imprecise
 * time string (e.g. "2:19"). In the latter case, the time will be rounded up
 * to the nearest tick.
 * @param time The time string.
 * @returns Number of ticks, or `null` if the time string is invalid.
 */
export function ticksFromTime(time: string): number | null {
  if (!/^\d+:\d{2}(\.\d{1,2})?$/.test(time)) {
    return null;
  }
  const [mins, rest] = time.split(':');
  const secs = rest.split('.');

  let milliseconds = Number(mins) * 60 * 1000 + Number(secs[0]) * 1000;

  if (secs.length === 2) {
    let centiseconds = secs[1];
    if (centiseconds.length === 1) {
      centiseconds += '0';
    }
    milliseconds += Number(centiseconds) * 10;
  }

  const remainder = milliseconds % TICK_MS;
  if (remainder !== 0) {
    milliseconds += TICK_MS - remainder;
  }

  return milliseconds / TICK_MS;
}

/**
 * Converts a number of ticks to a human-readable duration string.
 * @param ticks The number of ticks.
 * @returns The duration string.
 */
export function ticksToFormattedDuration(ticks: number): string {
  return formatDuration(ticks * TICK_MS);
}
