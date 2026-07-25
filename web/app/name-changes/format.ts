import { NameChange, NameChangeStatus } from '@blert/common';

import {
  MS_PER_DAY,
  formatMonthDay,
  formatMonthDayYear,
  formatMonthYear,
  timeAgo,
} from '@/utils/time';

/** Name changes fetched at a time. */
export const PAGE_SIZE = 15;

/** The user-facing outcome of a name change. */
export type FeedOutcome = 'pending' | 'accepted' | 'rejected';

/** A time bucket grouping consecutive feed rows. */
export type FeedGroup = {
  key: string;
  label: string;
};

/** A formatted feed row. */
export type FeedRow = {
  id: number;
  oldName: string;
  newName: string;
  outcome: FeedOutcome;
  rejectionReason: string | null;
  timeLabel: string;
  /** Full submitted/processed detail for the row's tooltip. */
  timeTooltip: string;
  group: FeedGroup;
};

function outcomeOf(status: NameChangeStatus): FeedOutcome {
  switch (status) {
    case NameChangeStatus.PENDING:
    case NameChangeStatus.DEFERRED:
      return 'pending';
    case NameChangeStatus.ACCEPTED:
      return 'accepted';
    case NameChangeStatus.OLD_STILL_IN_USE:
    case NameChangeStatus.NEW_DOES_NOT_EXIST:
    case NameChangeStatus.DECREASED_EXPERIENCE:
    case NameChangeStatus.FAILED:
      return 'rejected';
  }

  const _exhaustive: never = status;
  return 'rejected';
}

function rejectionReason(nameChange: NameChange): string | null {
  switch (nameChange.status) {
    case NameChangeStatus.OLD_STILL_IN_USE:
      return `"${nameChange.oldName}" is still on the Hiscores.`;
    case NameChangeStatus.NEW_DOES_NOT_EXIST:
      return `"${nameChange.newName}" is not on the Hiscores.`;
    case NameChangeStatus.DECREASED_EXPERIENCE:
      return `"${nameChange.newName}" has less experience than "${nameChange.oldName}".`;
    case NameChangeStatus.FAILED:
      return 'This name change could not be verified.';
    case NameChangeStatus.PENDING:
    case NameChangeStatus.ACCEPTED:
    case NameChangeStatus.DEFERRED:
      return null;
  }

  const _exhaustive: never = nameChange.status;
  return null;
}

function calendarDaysAgo(then: number, now: number): number {
  const a = new Date(now);
  a.setHours(0, 0, 0, 0);
  const b = new Date(then);
  b.setHours(0, 0, 0, 0);
  return Math.round((a.getTime() - b.getTime()) / MS_PER_DAY);
}

function describeInstant(then: number, now: number): string {
  if (calendarDaysAgo(then, now) <= 14) {
    return timeAgo(new Date(then), now);
  }
  const date = new Date(then);
  return date.getFullYear() === new Date(now).getFullYear()
    ? formatMonthDay(date)
    : formatMonthDayYear(date);
}

function groupFor(then: number, now: number): FeedGroup {
  const days = calendarDaysAgo(then, now);
  if (days <= 0) {
    return { key: 'today', label: 'Today' };
  }
  if (days <= 6) {
    return { key: 'week', label: 'This week' };
  }
  if (days <= 14) {
    return { key: 'earlier', label: 'Earlier' };
  }
  const date = new Date(then);
  return {
    key: `${date.getFullYear()}-${date.getMonth()}`,
    label: formatMonthYear(date),
  };
}

function tooltipFor(
  nameChange: NameChange,
  outcome: FeedOutcome,
  now: number,
): string {
  const submitted = `Submitted ${describeInstant(nameChange.submittedAt.getTime(), now)}`;
  if (outcome === 'pending') {
    return `${submitted} · awaiting processing`;
  }
  if (nameChange.processedAt !== null) {
    return `${submitted} · processed ${describeInstant(nameChange.processedAt.getTime(), now)}`;
  }
  return submitted;
}

/** Formats a raw name change into a displayable feed row, relative to `now`. */
export function toFeedRow(nameChange: NameChange, now: number): FeedRow {
  const outcome = outcomeOf(nameChange.status);
  const at = (nameChange.processedAt ?? nameChange.submittedAt).getTime();
  return {
    id: nameChange.id,
    oldName: nameChange.oldName,
    newName: nameChange.newName,
    outcome,
    rejectionReason:
      outcome === 'rejected' ? rejectionReason(nameChange) : null,
    timeLabel: describeInstant(at, now),
    timeTooltip: tooltipFor(nameChange, outcome, now),
    group: groupFor(at, now),
  };
}
