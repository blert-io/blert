import {
  ChallengeMode,
  ChallengeStatus,
  ChallengeType,
  SplitType,
} from '@blert/common';

import { sql } from '@/actions/db';
import { getSplitPercentiles } from '@/actions/split-distributions';

afterAll(async () => {
  await sql.end();
});

describe('getSplitPercentiles', () => {
  beforeEach(async () => {
    const challenge = (uuid: string, startTime: string, overrides = {}) => ({
      uuid,
      start_time: new Date(startTime),
      type: ChallengeType.TOB,
      mode: ChallengeMode.TOB_REGULAR,
      status: ChallengeStatus.RESET,
      scale: 2,
      challenge_ticks: 500,
      total_deaths: 0,
      ...overrides,
    });

    const challenges = [
      challenge('11111111-1111-1111-1111-111111111111', '2026-03-19'),
      challenge('22222222-2222-2222-2222-222222222222', '2026-04-19'),
      challenge('33333333-3333-3333-3333-333333333333', '2026-05-19'),
      challenge('44444444-4444-4444-4444-444444444444', '2026-06-19'),
      challenge('55555555-5555-5555-5555-555555555555', '2026-07-19', {
        status: ChallengeStatus.WIPED,
      }),
      challenge('66666666-6666-6666-6666-666666666666', '2026-03-24', {
        scale: 3,
      }),
      challenge('77777777-7777-7777-7777-777777777777', '2026-03-28'),
    ];

    const results =
      await sql`INSERT INTO challenges ${sql(challenges)} RETURNING id`;
    const ids = results.map((r) => r.id);

    const splits = [
      { challenge_id: ids[0], type: SplitType.TOB_REG_MAIDEN, ticks: 210 },
      { challenge_id: ids[1], type: SplitType.TOB_REG_MAIDEN, ticks: 210 },
      { challenge_id: ids[2], type: SplitType.TOB_REG_MAIDEN, ticks: 230 },
      { challenge_id: ids[3], type: SplitType.TOB_REG_MAIDEN, ticks: 250 },
      { challenge_id: ids[4], type: SplitType.TOB_REG_MAIDEN, ticks: 290 },
      { challenge_id: ids[0], type: SplitType.TOB_REG_BLOAT, ticks: 125 },
      { challenge_id: ids[1], type: SplitType.TOB_REG_BLOAT, ticks: 135 },
      { challenge_id: ids[2], type: SplitType.TOB_REG_BLOAT, ticks: 145 },
      { challenge_id: ids[3], type: SplitType.TOB_REG_BLOAT, ticks: 155 },
      // Excluded rows: different split, different scale, inaccurate split.
      {
        challenge_id: ids[0],
        type: SplitType.TOB_REG_MAIDEN_70S,
        ticks: 53,
      },
      {
        challenge_id: ids[5],
        type: SplitType.TOB_REG_MAIDEN,
        ticks: 1,
        scale: 3,
      },
      {
        challenge_id: ids[4],
        type: SplitType.TOB_REG_BLOAT,
        ticks: 165,
        accurate: false,
      },
    ].map((s) => ({ scale: 2, accurate: true, ...s }));

    await sql`INSERT INTO challenge_splits ${sql(splits)}`;
  });

  afterEach(async () => {
    await sql`DELETE FROM challenge_splits`;
    await sql`DELETE FROM challenges`;
  });

  it('computes percentiles per requested type over accurate splits', async () => {
    const result = await getSplitPercentiles(
      [
        SplitType.TOB_REG_MAIDEN,
        SplitType.TOB_REG_BLOAT,
        SplitType.TOB_REG_XARPUS,
      ],
      2,
      [0, 25, 50, 75, 100],
    );

    expect(result).toEqual([
      {
        splitType: SplitType.TOB_REG_MAIDEN,
        count: 5,
        percentiles: { 0: 210, 25: 210, 50: 230, 75: 250, 100: 290 },
      },
      {
        splitType: SplitType.TOB_REG_BLOAT,
        count: 4,
        percentiles: { 0: 125, 25: 132.5, 50: 140, 75: 147.5, 100: 155 },
      },
    ]);
  });

  it('interpolates fractional percentiles', async () => {
    const result = await getSplitPercentiles(
      [SplitType.TOB_REG_MAIDEN],
      2,
      [12.5, 87.5],
    );

    expect(result).toEqual([
      {
        splitType: SplitType.TOB_REG_MAIDEN,
        count: 5,
        percentiles: { 12.5: 210, 87.5: 270 },
      },
    ]);
  });

  it('restricts to challenges within the time window', async () => {
    const after = await getSplitPercentiles(
      [SplitType.TOB_REG_MAIDEN],
      2,
      [50],
      new Date('2026-04-01'),
    );
    expect(after).toEqual([
      {
        splitType: SplitType.TOB_REG_MAIDEN,
        count: 4,
        percentiles: { 50: 240 },
      },
    ]);

    const before = await getSplitPercentiles(
      [SplitType.TOB_REG_MAIDEN],
      2,
      [50],
      undefined,
      new Date('2026-07-01'),
    );
    expect(before).toEqual([
      {
        splitType: SplitType.TOB_REG_MAIDEN,
        count: 4,
        percentiles: { 50: 220 },
      },
    ]);

    const windowed = await getSplitPercentiles(
      [SplitType.TOB_REG_MAIDEN],
      2,
      [50],
      new Date('2026-04-01'),
      new Date('2026-07-01'),
    );
    expect(windowed).toEqual([
      {
        splitType: SplitType.TOB_REG_MAIDEN,
        count: 3,
        percentiles: { 50: 230 },
      },
    ]);
  });

  it('filters splits by scale', async () => {
    const result = await getSplitPercentiles(
      [SplitType.TOB_REG_MAIDEN],
      3,
      [0, 50, 100],
    );

    expect(result).toEqual([
      {
        splitType: SplitType.TOB_REG_MAIDEN,
        count: 1,
        percentiles: { 0: 1, 50: 1, 100: 1 },
      },
    ]);
  });

  it('returns an empty array when no requested type has data', async () => {
    const result = await getSplitPercentiles(
      [SplitType.TOB_REG_XARPUS],
      2,
      [50],
    );
    expect(result).toEqual([]);
  });
});
