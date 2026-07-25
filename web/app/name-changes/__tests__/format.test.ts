import { NameChange, NameChangeKind, NameChangeStatus } from '@blert/common';

import { toFeedRow } from '../format';

// Reference date.
const NOW = new Date(2026, 6, 24, 15, 0, 0);
const NOW_MS = NOW.getTime();

/** Time before `NOW` */
function daysBefore(days: number): Date {
  return new Date(2026, 6, 24 - days, 15, 0, 0);
}

function nameChange(fields: Partial<NameChange> = {}): NameChange {
  return {
    id: 41,
    status: NameChangeStatus.ACCEPTED,
    oldName: 'mdps scy',
    newName: 'WWWWWWWWWWQQ',
    submittedAt: new Date(NOW_MS - 3 * 60 * 60 * 1000),
    processedAt: new Date(NOW_MS - 2 * 60 * 60 * 1000),
    kind: NameChangeKind.STANDARD,
    effectiveFrom: new Date(NOW_MS - 2 * 60 * 60 * 1000),
    effectiveTo: null,
    sequenceId: null,
    ...fields,
  };
}

describe('toFeedRow', () => {
  it('formats an accepted change processed today', () => {
    expect(toFeedRow(nameChange(), NOW_MS)).toEqual({
      id: 41,
      oldName: 'mdps scy',
      newName: 'WWWWWWWWWWQQ',
      outcome: 'accepted',
      rejectionReason: null,
      timeLabel: '2h ago',
      timeTooltip: 'Submitted 3h ago · processed 2h ago',
      group: { key: 'today', label: 'Today' },
    });
  });

  it('formats an unprocessed change as pending, dated by submission', () => {
    const change = nameChange({
      status: NameChangeStatus.PENDING,
      submittedAt: new Date(NOW_MS - 30 * 60 * 1000),
      processedAt: null,
    });

    expect(toFeedRow(change, NOW_MS)).toEqual({
      id: 41,
      oldName: 'mdps scy',
      newName: 'WWWWWWWWWWQQ',
      outcome: 'pending',
      rejectionReason: null,
      timeLabel: '30m ago',
      timeTooltip: 'Submitted 30m ago · awaiting processing',
      group: { key: 'today', label: 'Today' },
    });
  });

  it('treats a deferred change as pending', () => {
    const change = nameChange({
      status: NameChangeStatus.DEFERRED,
      submittedAt: new Date(NOW_MS - 30 * 60 * 1000),
      processedAt: null,
    });

    expect(toFeedRow(change, NOW_MS)).toEqual({
      id: 41,
      oldName: 'mdps scy',
      newName: 'WWWWWWWWWWQQ',
      outcome: 'pending',
      rejectionReason: null,
      timeLabel: '30m ago',
      timeTooltip: 'Submitted 30m ago · awaiting processing',
      group: { key: 'today', label: 'Today' },
    });
  });

  it('labels a submission under a minute old as just now', () => {
    const change = nameChange({
      status: NameChangeStatus.PENDING,
      submittedAt: new Date(NOW_MS - 30 * 1000),
      processedAt: null,
    });

    expect(toFeedRow(change, NOW_MS).timeLabel).toBe('just now');
  });

  it('dates a change by its processing time, not its submission', () => {
    const change = nameChange({
      submittedAt: daysBefore(60),
      processedAt: new Date(NOW_MS - 60 * 60 * 1000),
    });

    expect(toFeedRow(change, NOW_MS)).toEqual({
      id: 41,
      oldName: 'mdps scy',
      newName: 'WWWWWWWWWWQQ',
      outcome: 'accepted',
      rejectionReason: null,
      timeLabel: '1h ago',
      timeTooltip: 'Submitted May 25 · processed 1h ago',
      group: { key: 'today', label: 'Today' },
    });
  });

  describe('rejections', () => {
    it.each([
      [
        NameChangeStatus.OLD_STILL_IN_USE,
        '"mdps scy" is still on the Hiscores.' as string,
      ],
      [
        NameChangeStatus.NEW_DOES_NOT_EXIST,
        '"WWWWWWWWWWQQ" is not on the Hiscores.',
      ],
      [
        NameChangeStatus.DECREASED_EXPERIENCE,
        '"WWWWWWWWWWQQ" has less experience than "mdps scy".',
      ],
      [NameChangeStatus.FAILED, 'This name change could not be verified.'],
    ])('explains status %s', (status, reason) => {
      const row = toFeedRow(nameChange({ status }), NOW_MS);
      expect(row.outcome).toBe('rejected');
      expect(row.rejectionReason).toBe(reason);
    });

    it.each([
      NameChangeStatus.PENDING,
      NameChangeStatus.ACCEPTED,
      NameChangeStatus.DEFERRED,
    ])('carries no rejection reason for status %s', (status) => {
      expect(toFeedRow(nameChange({ status }), NOW_MS).rejectionReason).toBe(
        null,
      );
    });
  });

  describe('time bucketing', () => {
    it.each([
      [0, 'today', 'Today', 'just now'],
      [1, 'week', 'This week', '1d ago'],
      [6, 'week', 'This week', '6d ago'],
      [7, 'earlier', 'Earlier', '1w ago'],
      [14, 'earlier', 'Earlier', '2w ago'],
      [15, '2026-6', 'July 2026', 'Jul 9'],
      [40, '2026-5', 'June 2026', 'Jun 14'],
    ])(
      '%s day(s) ago groups under %s',
      (days, key, label, timeLabel: string) => {
        const at = daysBefore(days);
        const row = toFeedRow(
          nameChange({ submittedAt: at, processedAt: at }),
          NOW_MS,
        );

        expect(row.group).toEqual({ key, label });
        expect(row.timeLabel).toBe(timeLabel);
      },
    );

    it('includes the year for a change from a previous year', () => {
      const at = new Date(2025, 11, 15, 15, 0, 0);
      const row = toFeedRow(
        nameChange({ submittedAt: at, processedAt: at }),
        NOW_MS,
      );

      expect(row.group).toEqual({ key: '2025-11', label: 'December 2025' });
      expect(row.timeLabel).toBe('Dec 15, 2025');
    });
  });
});
