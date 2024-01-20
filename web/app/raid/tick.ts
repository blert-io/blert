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
