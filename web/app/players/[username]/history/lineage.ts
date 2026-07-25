import {
  DAYS_PER_MONTH,
  DAYS_PER_YEAR,
  MS_PER_DAY,
  formatMonthDay,
  formatMonthDayYear,
} from '@/utils/time';

/** A single name a player held, as a node in their lineage timeline. */
export type LineageNode = {
  name: string;
  /** `current` = the name in use now; `origin` = the oldest tracked name. */
  kind: 'current' | 'interval' | 'origin';
  /** Right-aligned date text, e.g. "since Feb 18, 2026" or a range. */
  dateLabel: string;
  /** Duration the name was held (closed intervals only), else null. */
  duration: string | null;
};

type AcceptedChange = {
  oldName: string;
  newName: string;
  effectiveFrom: Date;
};

function formatRange(start: Date, end: Date): string {
  // If the year is the same, only show it once.
  if (start.getFullYear() === end.getFullYear()) {
    return `${formatMonthDay(start)} – ${formatMonthDayYear(end)}`;
  }
  return `${formatMonthDayYear(start)} – ${formatMonthDayYear(end)}`;
}

function approxDuration(start: Date, end: Date): string {
  const days = Math.max(
    1,
    Math.round((end.getTime() - start.getTime()) / MS_PER_DAY),
  );
  if (days < 45) {
    return `${days} ${days === 1 ? 'day' : 'days'}`;
  }
  const months = Math.round(days / DAYS_PER_MONTH);
  if (months < 24) {
    return `${months} ${months === 1 ? 'month' : 'months'}`;
  }
  const years = Math.round(days / DAYS_PER_YEAR);
  return `${years} ${years === 1 ? 'year' : 'years'}`;
}

/**
 * Builds a player's name lineage from their accepted name changes.
 *
 * @param changes Accepted changes in any order.
 * @returns Timeline nodes.
 */
export function buildNameLineage(changes: AcceptedChange[]): LineageNode[] {
  if (changes.length === 0) {
    return [];
  }

  // Sort so each pair of consecutive changes bounds one interval.
  const ascending = changes.toSorted(
    (a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime(),
  );

  const nodes: LineageNode[] = [];

  const latest = ascending[ascending.length - 1];
  nodes.push({
    name: latest.newName,
    kind: 'current',
    dateLabel: `since ${formatMonthDayYear(latest.effectiveFrom)}`,
    duration: null,
  });

  for (let i = ascending.length - 2; i >= 0; i--) {
    const start = ascending[i].effectiveFrom;
    const end = ascending[i + 1].effectiveFrom;
    nodes.push({
      name: ascending[i].newName,
      kind: 'interval',
      dateLabel: formatRange(start, end),
      duration: approxDuration(start, end),
    });
  }

  const oldest = ascending[0];
  nodes.push({
    name: oldest.oldName,
    kind: 'origin',
    dateLabel: `until ${formatMonthDayYear(oldest.effectiveFrom)}`,
    duration: '(first tracked)',
  });

  return nodes;
}
