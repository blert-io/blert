/**
 * Formats a duration in milliseconds to a string of the form "3h 4m", rounded
 * to the nearest minute.
 *
 * @param milliseconds The duration in milliseconds.
 * @returns The formatted duration string.
 */
export function formatDuration(milliseconds: number): string {
  const mins = Math.round(milliseconds / 1000 / 60);
  if (mins > 60) {
    return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  }
  return `${mins}m`;
}
