import {
  ChallengeMode,
  ChallengeStatus,
  ChallengeType,
  normalizeRsn,
} from '@blert/common';

import { sql } from '@/actions/db';
import { aggregateBloatHands } from '@/actions/bloat-hands';

describe('aggregateBloatHands', () => {
  let challengeIds: number[];

  beforeEach(async () => {
    const players = [
      {
        username: 'Player1',
        normalized_username: normalizeRsn('Player1'),
        total_recordings: 5,
        overall_experience: 200_000_000,
        attack_experience: 13_000_000,
        defence_experience: 13_000_000,
        strength_experience: 13_000_000,
        hitpoints_experience: 13_000_000,
        ranged_experience: 13_000_000,
        prayer_experience: 13_000_000,
        magic_experience: 13_000_000,
      },
    ];

    await sql`INSERT INTO players ${sql(players)}`;

    const challenges = [
      {
        uuid: '11111111-1111-1111-1111-111111111111',
        start_time: new Date('2024-01-01'),
        type: ChallengeType.TOB,
        mode: ChallengeMode.TOB_REGULAR,
        status: ChallengeStatus.COMPLETED,
        scale: 2,
        challenge_ticks: 1000,
        overall_ticks: 1200,
        total_deaths: 0,
      },
      {
        uuid: '22222222-2222-2222-2222-222222222222',
        start_time: new Date('2024-01-02'),
        type: ChallengeType.TOB,
        mode: ChallengeMode.TOB_REGULAR,
        status: ChallengeStatus.COMPLETED,
        scale: 2,
        challenge_ticks: 1100,
        overall_ticks: 1300,
        total_deaths: 1,
      },
      {
        uuid: '33333333-3333-3333-3333-333333333333',
        start_time: new Date('2024-01-03'),
        type: ChallengeType.TOB,
        mode: ChallengeMode.TOB_HARD,
        status: ChallengeStatus.COMPLETED,
        scale: 2,
        challenge_ticks: 1200,
        overall_ticks: 1400,
        total_deaths: 2,
      },
      {
        uuid: '44444444-4444-4444-4444-444444444444',
        start_time: new Date('2024-01-04'),
        type: ChallengeType.TOB,
        mode: ChallengeMode.TOB_REGULAR,
        status: ChallengeStatus.ABANDONED,
        scale: 2,
        challenge_ticks: 800,
        overall_ticks: 800,
        total_deaths: 5,
      },
    ];

    const challengeResults =
      await sql`INSERT INTO challenges ${sql(challenges)} RETURNING id`;
    challengeIds = challengeResults.map((r) => r.id);

    const bloatHands = [
      // Challenge 1: 3 hands
      {
        challenge_id: challengeIds[0],
        wave_number: 1,
        tile_id: 17,
        chunk: 1,
        intra_chunk_order: 0,
      },
      {
        challenge_id: challengeIds[0],
        wave_number: 1,
        tile_id: 34,
        chunk: 2,
        intra_chunk_order: 0,
      },
      {
        challenge_id: challengeIds[0],
        wave_number: 1,
        tile_id: 17,
        chunk: 1,
        intra_chunk_order: 1,
      },
      // Challenge 2: 2 hands
      {
        challenge_id: challengeIds[1],
        wave_number: 1,
        tile_id: 17,
        chunk: 1,
        intra_chunk_order: 0,
      },
      {
        challenge_id: challengeIds[1],
        wave_number: 1,
        tile_id: 100,
        chunk: 2,
        intra_chunk_order: 0,
      },
      // Challenge 3 (hard mode): 2 hands
      {
        challenge_id: challengeIds[2],
        wave_number: 1,
        tile_id: 17,
        chunk: 1,
        intra_chunk_order: 0,
      },
      {
        challenge_id: challengeIds[2],
        wave_number: 1,
        tile_id: 17,
        chunk: 1,
        intra_chunk_order: 1,
      },
      // Challenge 4 (abandoned): 1 hand
      {
        challenge_id: challengeIds[3],
        wave_number: 1,
        tile_id: 17,
        chunk: 1,
        intra_chunk_order: 0,
      },
    ];

    await sql`INSERT INTO bloat_hands ${sql(bloatHands)}`;
    await sql`REFRESH MATERIALIZED VIEW mv_bloat_hands_daily`;
  });

  afterEach(async () => {
    await sql`DELETE FROM bloat_hands`;
    await sql`DELETE FROM challenges`;
    await sql`DELETE FROM players`;
    await sql`REFRESH MATERIALIZED VIEW mv_bloat_hands_daily`;
  });

  afterAll(async () => {
    await sql.end();
  });

  it('aggregates total hands per tile across all non-abandoned challenges', async () => {
    const result = await aggregateBloatHands({});

    expect(result.totalChallenges).toBe(3);
    expect(result.totalHands).toBe(7);
    expect(result.byTile['17']).toBe(5);
    expect(result.byTile['34']).toBe(1);
    expect(result.byTile['100']).toBe(1);
  });

  it('filters by challenge mode', async () => {
    const result = await aggregateBloatHands({
      mode: [ChallengeMode.TOB_HARD],
    });

    expect(result.totalChallenges).toBe(1);
    expect(result.totalHands).toBe(2);
    expect(result.byTile['17']).toBe(2);
  });

  it('filters by date range', async () => {
    const result = await aggregateBloatHands({
      startTime: ['>=', new Date('2024-01-02')],
    });

    // Challenges 2 (regular) and 3 (hard); challenge 4 is abandoned.
    expect(result.totalChallenges).toBe(2);
    expect(result.totalHands).toBe(4);
  });

  it('filters by intra-chunk order', async () => {
    const result = await aggregateBloatHands({ intraChunkOrder: 0 });

    // Only first-in-chunk hands; totalChallenges is unfiltered.
    expect(result.totalChallenges).toBe(3);
    expect(result.totalHands).toBe(7);
    expect(result.byTile['17']).toBe(3);
    expect(result.byTile['34']).toBe(1);
    expect(result.byTile['100']).toBe(1);
    expect(result.byTile).not.toHaveProperty('50');
  });

  it('filters by later intra-chunk orders', async () => {
    const result = await aggregateBloatHands({ intraChunkOrder: 1 });

    expect(result.totalChallenges).toBe(3);
    expect(result.byTile['17']).toBe(2);
    expect(Object.keys(result.byTile)).toEqual(['17']);
  });

  it('combines mode and date filters', async () => {
    const result = await aggregateBloatHands({
      mode: [ChallengeMode.TOB_REGULAR],
      startTime: ['>=', new Date('2024-01-02')],
    });

    expect(result.totalChallenges).toBe(1);
    expect(result.totalHands).toBe(2);
    expect(result.byTile['17']).toBe(1);
    expect(result.byTile['100']).toBe(1);
  });

  it('returns zeros when no challenges match', async () => {
    const result = await aggregateBloatHands({
      mode: [ChallengeMode.TOB_ENTRY],
    });

    expect(result.totalChallenges).toBe(0);
    expect(result.totalHands).toBe(0);
    expect(result.byTile).toEqual({});
  });
});
