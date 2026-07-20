import { SplitType } from '@blert/common';

import {
  Distribution,
  attachPlayerMarks,
  playerWaveMarks,
  sixMonthsAgo,
  wavesToCategories,
} from '../data';

describe('wavesToCategories', () => {
  it('drops non-wave splits and orders waves by number', () => {
    const result = wavesToCategories([
      {
        splitType: SplitType.COLOSSEUM_WAVE_12,
        count: 14,
        percentiles: { 5: 183.15, 25: 193.25, 50: 209, 75: 227.5, 95: 257.1 },
      },
      {
        splitType: SplitType.COLOSSEUM_CHALLENGE,
        count: 39,
        percentiles: { 5: 1689, 25: 1793, 50: 1955, 75: 2207.5, 95: 2481.3 },
      },
      {
        splitType: SplitType.COLOSSEUM_WAVE_1,
        count: 552,
        percentiles: { 5: 27, 25: 30, 50: 34, 75: 39, 95: 48 },
      },
    ]);

    expect(result).toEqual([
      {
        key: SplitType.COLOSSEUM_WAVE_1,
        label: '1',
        name: 'Wave 1',
        count: 552,
        stats: { p5: 27, p25: 30, p50: 34, p75: 39, p95: 48 },
      },
      {
        key: SplitType.COLOSSEUM_WAVE_12,
        label: 'Sol',
        name: 'Sol Heredit',
        count: 14,
        stats: { p5: 183.15, p25: 193.25, p50: 209, p75: 227.5, p95: 257.1 },
      },
    ]);
  });

  it('returns an empty array when no wave splits are present', () => {
    expect(
      wavesToCategories([
        {
          splitType: SplitType.COLOSSEUM_CHALLENGE,
          count: 39,
          percentiles: { 5: 1689, 25: 1793, 50: 1955, 75: 2207.5, 95: 2481.3 },
        },
      ]),
    ).toEqual([]);
  });
});

describe('playerWaveMarks', () => {
  const playerDistributions: Distribution[] = [
    {
      splitType: SplitType.COLOSSEUM_WAVE_1,
      bins: [
        { ticks: 30, count: 1 },
        { ticks: 34, count: 2 },
        { ticks: 40, count: 1 },
      ],
      total: 4,
    },
    {
      splitType: SplitType.COLOSSEUM_WAVE_2,
      bins: [{ ticks: 120, count: 1 }],
      total: 1,
    },
    {
      splitType: SplitType.COLOSSEUM_WAVE_3,
      bins: [{ ticks: 95, count: 3 }],
      total: 3,
    },
    {
      splitType: SplitType.COLOSSEUM_WAVE_4,
      bins: [],
      total: 0,
    },
  ];

  const globalDistributions: Distribution[] = [
    {
      splitType: SplitType.COLOSSEUM_WAVE_1,
      bins: [
        { ticks: 27, count: 5 },
        { ticks: 30, count: 10 },
        { ticks: 34, count: 20 },
        { ticks: 39, count: 10 },
        { ticks: 48, count: 5 },
      ],
      total: 50,
    },
    {
      splitType: SplitType.COLOSSEUM_WAVE_2,
      bins: [
        { ticks: 60, count: 15 },
        { ticks: 100, count: 5 },
      ],
      total: 20,
    },
  ];

  it('computes medians and standings against global distributions', () => {
    const marks = playerWaveMarks(
      playerDistributions,
      globalDistributions,
      new Map([
        [SplitType.COLOSSEUM_WAVE_1 as number, 56],
        [SplitType.COLOSSEUM_WAVE_2 as number, 22],
      ]),
    );

    expect(marks).toEqual(
      new Map([
        // Median 34 sits at a cumulative 35 of the wave's 56 full samples.
        [
          SplitType.COLOSSEUM_WAVE_1,
          { median: 34, count: 4, percentile: 62.5 },
        ],
        // Median 120 is beyond the trimmed global bins.
        [SplitType.COLOSSEUM_WAVE_2, { median: 120, count: 1 }],
        // No global distribution for wave 3.
        [SplitType.COLOSSEUM_WAVE_3, { median: 95, count: 3 }],
      ]),
    );
  });

  it('omits standings without a full sample count', () => {
    const marks = playerWaveMarks(
      playerDistributions,
      globalDistributions,
      new Map(),
    );

    expect(marks.get(SplitType.COLOSSEUM_WAVE_1)).toEqual({
      median: 34,
      count: 4,
    });
  });

  it('omits standings without global distributions', () => {
    const marks = playerWaveMarks(
      playerDistributions,
      null,
      new Map([[SplitType.COLOSSEUM_WAVE_1 as number, 56]]),
    );

    expect(marks).toEqual(
      new Map([
        [SplitType.COLOSSEUM_WAVE_1, { median: 34, count: 4 }],
        [SplitType.COLOSSEUM_WAVE_2, { median: 120, count: 1 }],
        [SplitType.COLOSSEUM_WAVE_3, { median: 95, count: 3 }],
      ]),
    );
  });
});

describe('sixMonthsAgo', () => {
  // Values verified against Postgres' `timestamp - INTERVAL '6 months'`.
  it.each([
    ['2026-07-20T23:59:59Z', '2026-01-20T00:00:00.000Z'],
    ['2026-08-31T15:30:00Z', '2026-02-28T00:00:00.000Z'],
    ['2024-08-31T00:00:00Z', '2024-02-29T00:00:00.000Z'],
    ['2026-05-31T12:00:00Z', '2025-11-30T00:00:00.000Z'],
    ['2026-12-31T06:00:00Z', '2026-06-30T00:00:00.000Z'],
  ])('maps %s to %s', (from, expected) => {
    expect(sixMonthsAgo(new Date(from)).toISOString()).toBe(expected);
  });
});

describe('attachPlayerMarks', () => {
  it('attaches marks only to matching categories', () => {
    const categories = wavesToCategories([
      {
        splitType: SplitType.COLOSSEUM_WAVE_1,
        count: 552,
        percentiles: { 5: 27, 25: 30, 50: 34, 75: 39, 95: 48 },
      },
      {
        splitType: SplitType.COLOSSEUM_WAVE_2,
        count: 505,
        percentiles: { 5: 52, 25: 60, 50: 87, 75: 100, 95: 114 },
      },
    ]);

    const marks = new Map([
      [SplitType.COLOSSEUM_WAVE_1 as number, { median: 34, count: 4 }],
    ]);

    expect(attachPlayerMarks(categories, marks)).toEqual([
      {
        key: SplitType.COLOSSEUM_WAVE_1,
        label: '1',
        name: 'Wave 1',
        count: 552,
        stats: { p5: 27, p25: 30, p50: 34, p75: 39, p95: 48 },
        player: { median: 34, count: 4 },
      },
      {
        key: SplitType.COLOSSEUM_WAVE_2,
        label: '2',
        name: 'Wave 2',
        count: 505,
        stats: { p5: 52, p25: 60, p50: 87, p75: 100, p95: 114 },
      },
    ]);
  });
});
