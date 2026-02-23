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

/**
 * Formats a date as a relative time string (e.g. "5m ago", "2h ago").
 *
 * @param date The date to format.
 * @returns A human-readable relative time string.
 */
export function timeAgo(date: string | Date): string {
  const ms = Date.now() - new Date(date).getTime();
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return 'just now';
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
