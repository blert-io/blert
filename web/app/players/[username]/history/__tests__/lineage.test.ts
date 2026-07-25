import { buildNameLineage } from '../lineage';

describe('buildNameLineage', () => {
  it('returns nothing when there are no changes', () => {
    expect(buildNameLineage([])).toEqual([]);
  });

  it('bounds a single change by a current and an origin node', () => {
    const changes = [
      {
        oldName: 'mdps scy',
        newName: 'WWWWWWWWWWQQ',
        effectiveFrom: new Date('2026-03-18T00:00:00'),
      },
    ];

    expect(buildNameLineage(changes)).toEqual([
      {
        name: 'WWWWWWWWWWQQ',
        kind: 'current',
        dateLabel: 'since Mar 18, 2026',
        duration: null,
      },
      {
        name: 'mdps scy',
        kind: 'origin',
        dateLabel: 'until Mar 18, 2026',
        duration: '(first tracked)',
      },
    ]);
  });

  it('orders nodes newest-first regardless of input order', () => {
    const older = {
      oldName: 'mdps scy',
      newName: 'Im 6 Slotted',
      effectiveFrom: new Date('2025-01-01T00:00:00'),
    };
    const newer = {
      oldName: 'Im 6 Slotted',
      newName: 'WWWWWWWWWWQQ',
      effectiveFrom: new Date('2025-03-02T00:00:00'),
    };

    const expected = [
      {
        name: 'WWWWWWWWWWQQ',
        kind: 'current',
        dateLabel: 'since Mar 2, 2025',
        duration: null,
      },
      {
        name: 'Im 6 Slotted',
        kind: 'interval',
        dateLabel: 'Jan 1 – Mar 2, 2025',
        duration: '2 months',
      },
      {
        name: 'mdps scy',
        kind: 'origin',
        dateLabel: 'until Jan 1, 2025',
        duration: '(first tracked)',
      },
    ];

    expect(buildNameLineage([older, newer])).toEqual(expected);
    expect(buildNameLineage([newer, older])).toEqual(expected);
  });

  it('pairs each name with the interval it was held for', () => {
    const changes = [
      {
        oldName: 'mdps scy',
        newName: 'Im 6 Slotted',
        effectiveFrom: new Date('2025-01-01T00:00:00'),
      },
      {
        oldName: 'Im 6 Slotted',
        newName: 'Sacolyn1Ogp',
        effectiveFrom: new Date('2025-02-01T00:00:00'),
      },
      {
        oldName: 'Sacolyn1Ogp',
        newName: 'WWWWWWWWWWQQ',
        effectiveFrom: new Date('2025-03-01T00:00:00'),
      },
    ];

    expect(buildNameLineage(changes)).toEqual([
      {
        name: 'WWWWWWWWWWQQ',
        kind: 'current',
        dateLabel: 'since Mar 1, 2025',
        duration: null,
      },
      {
        name: 'Sacolyn1Ogp',
        kind: 'interval',
        dateLabel: 'Feb 1 – Mar 1, 2025',
        duration: '28 days',
      },
      {
        name: 'Im 6 Slotted',
        kind: 'interval',
        dateLabel: 'Jan 1 – Feb 1, 2025',
        duration: '31 days',
      },
      {
        name: 'mdps scy',
        kind: 'origin',
        dateLabel: 'until Jan 1, 2025',
        duration: '(first tracked)',
      },
    ]);
  });

  describe('interval durations', () => {
    function intervalNode(start: Date, end: Date) {
      const nodes = buildNameLineage([
        { oldName: 'mdps scy', newName: 'Im 6 Slotted', effectiveFrom: start },
        {
          oldName: 'Im 6 Slotted',
          newName: 'WWWWWWWWWWQQ',
          effectiveFrom: end,
        },
      ]);
      return nodes[1];
    }

    it('counts a same-day interval as one day', () => {
      expect(
        intervalNode(
          new Date('2026-01-01T09:00:00'),
          new Date('2026-01-01T15:00:00'),
        ),
      ).toEqual({
        name: 'Im 6 Slotted',
        kind: 'interval',
        dateLabel: 'Jan 1 – Jan 1, 2026',
        duration: '1 day',
      });
    });

    it('counts a single day', () => {
      expect(
        intervalNode(
          new Date('2026-01-01T00:00:00'),
          new Date('2026-01-02T00:00:00'),
        ),
      ).toMatchObject({ dateLabel: 'Jan 1 – Jan 2, 2026', duration: '1 day' });
    });

    it('reports days below the month threshold', () => {
      expect(
        intervalNode(
          new Date('2026-01-01T00:00:00'),
          new Date('2026-01-11T00:00:00'),
        ),
      ).toMatchObject({
        dateLabel: 'Jan 1 – Jan 11, 2026',
        duration: '10 days',
      });
    });

    it('switches to months at 45 days', () => {
      expect(
        intervalNode(
          new Date('2026-01-01T00:00:00'),
          new Date('2026-02-15T00:00:00'),
        ),
      ).toMatchObject({
        dateLabel: 'Jan 1 – Feb 15, 2026',
        duration: '1 month',
      });
    });

    it('switches to years once the interval reaches 24 months', () => {
      expect(
        intervalNode(
          new Date('2024-01-01T00:00:00'),
          new Date('2026-01-01T00:00:00'),
        ),
      ).toMatchObject({
        dateLabel: 'Jan 1, 2024 – Jan 1, 2026',
        duration: '2 years',
      });
    });
  });
});
