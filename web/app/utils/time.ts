/** Number of milliseconds in one day. */
export const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Average days in a Gregorian year. */
export const DAYS_PER_YEAR = 365.2425;

/** Average days in a month. */
export const DAYS_PER_MONTH = DAYS_PER_YEAR / 12;

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
 * Formats a date as a relative time string (e.g. "5m ago", "2h ago", "3w ago").
 *
 * @param date The date to format.
 * @param now Reference "now" instant in ms. Defaults to the current time; pass
 *   a fixed value to keep output deterministic (e.g. server-rendered strings).
 * @returns A human-readable relative time string.
 */
export function timeAgo(date: string | Date, now: number = Date.now()): string {
  const ms = now - new Date(date).getTime();
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
  if (days < 7) {
    return `${days}d ago`;
  }
  return `${Math.floor(days / 7)}w ago`;
}

// Locale is pinned so formatted dates are deterministic regardless of the
// server's environment locale (avoids SSR/client mismatch).
const monthDay = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
});
const monthDayYear = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});
const monthYear = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  year: 'numeric',
});

/** Formats a date as "Feb 18". */
export function formatMonthDay(date: Date): string {
  return monthDay.format(date);
}

/** Formats a date as "Feb 18, 2026". */
export function formatMonthDayYear(date: Date): string {
  return monthDayYear.format(date);
}

/** Formats a date as "June 2026". */
export function formatMonthYear(date: Date): string {
  return monthYear.format(date);
}
