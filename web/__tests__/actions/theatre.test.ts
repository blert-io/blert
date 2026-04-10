import {
  ChallengeMode,
  ChallengeStatus,
  ChallengeType,
  EventType,
  normalizeRsn,
  QueryableEventRow,
  Stage,
} from '@blert/common';

import { sql } from '@/actions/db';
import { aggregateBloatDowns, aggregateBloatHands } from '@/actions/theatre';

afterAll(async () => {
  await sql.end();
});

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

describe('aggregateBloatDowns', () => {
  let challengeIds: number[];

  function bloatDownEvent(
    challengeId: number,
    mode: ChallengeMode,
    tick: number,
    downNumber: number,
    walkTicks: number,
  ): QueryableEventRow {
    return {
      challenge_id: challengeId,
      event_type: EventType.TOB_BLOAT_DOWN,
      stage: Stage.TOB_BLOAT,
      mode,
      tick,
      x_coord: 0,
      y_coord: 0,
      subtype: null,
      player_id: null,
      npc_id: null,
      custom_int_1: null,
      custom_int_2: null,
      custom_short_1: downNumber,
      custom_short_2: walkTicks,
    };
  }

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
        scale: 4,
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
        scale: 4,
        challenge_ticks: 1100,
        overall_ticks: 1300,
        total_deaths: 0,
      },
      {
        uuid: '33333333-3333-3333-3333-333333333333',
        start_time: new Date('2024-01-03'),
        type: ChallengeType.TOB,
        mode: ChallengeMode.TOB_HARD,
        status: ChallengeStatus.COMPLETED,
        scale: 4,
        challenge_ticks: 1200,
        overall_ticks: 1400,
        total_deaths: 0,
      },
      {
        uuid: '44444444-4444-4444-4444-444444444444',
        start_time: new Date('2024-01-04'),
        type: ChallengeType.TOB,
        mode: ChallengeMode.TOB_REGULAR,
        status: ChallengeStatus.ABANDONED,
        scale: 4,
        challenge_ticks: 800,
        overall_ticks: 800,
        total_deaths: 0,
      },
    ];

    const challengeResults =
      await sql`INSERT INTO challenges ${sql(challenges)} RETURNING id`;
    challengeIds = challengeResults.map((r) => r.id);

    const mode = ChallengeMode.TOB_REGULAR;
    const hmMode = ChallengeMode.TOB_HARD;

    const events = [
      // Challenge 1: 3-down bloat, walk times 41, 40, 39
      bloatDownEvent(challengeIds[0], mode, 41, 1, 41),
      bloatDownEvent(challengeIds[0], mode, 115, 2, 40),
      bloatDownEvent(challengeIds[0], mode, 189, 3, 39),
      // Challenge 2: 2-down bloat, walk times 41, 42
      bloatDownEvent(challengeIds[1], mode, 41, 1, 41),
      bloatDownEvent(challengeIds[1], mode, 117, 2, 42),
      // Challenge 3 (hard mode): 3-down bloat, walk times 39, 38, 40
      bloatDownEvent(challengeIds[2], hmMode, 39, 1, 39),
      bloatDownEvent(challengeIds[2], hmMode, 111, 2, 38),
      bloatDownEvent(challengeIds[2], hmMode, 185, 3, 40),
      // Challenge 4 (abandoned): should be excluded
      bloatDownEvent(challengeIds[3], mode, 41, 1, 41),
    ];

    await sql`INSERT INTO queryable_events ${sql(events)}`;
    await sql`REFRESH MATERIALIZED VIEW mv_bloat_downs_daily`;
  });

  afterEach(async () => {
    await sql`DELETE FROM queryable_events`;
    await sql`DELETE FROM challenges`;
    await sql`DELETE FROM players`;
    await sql`REFRESH MATERIALIZED VIEW mv_bloat_downs_daily`;
  });

  it('aggregates walk time distribution across all non-abandoned challenges', async () => {
    const result = await aggregateBloatDowns({});

    // 8 total downs (3 + 2 + 3), abandoned challenge excluded
    expect(result.totalDowns).toBe(8);
    expect(result.byWalkTicks['38']).toBe(1);
    expect(result.byWalkTicks['39']).toBe(2);
    expect(result.byWalkTicks['40']).toBe(2);
    expect(result.byWalkTicks['41']).toBe(2);
    expect(result.byWalkTicks['42']).toBe(1);
  });

  it('filters by mode', async () => {
    const result = await aggregateBloatDowns({
      mode: [ChallengeMode.TOB_REGULAR],
    });
    expect(result.totalDowns).toBe(5);
    expect(result.byWalkTicks['41']).toBe(2);
    expect(result.byWalkTicks['38']).toBeUndefined();
  });

  it('filters by down number', async () => {
    const result = await aggregateBloatDowns({
      downNumber: ['==', 1],
    });
    expect(result.totalDowns).toBe(3);
    expect(result.byWalkTicks['41']).toBe(2);
    expect(result.byWalkTicks['39']).toBe(1);
  });

  it('filters by down number with comparator', async () => {
    const result = await aggregateBloatDowns({
      downNumber: ['>', 1],
    });
    expect(result.totalDowns).toBe(5);
    expect(result.byWalkTicks).not.toHaveProperty('41');
  });

  it('filters by scale', async () => {
    const result = await aggregateBloatDowns({ scale: [5] });
    expect(result.totalDowns).toBe(0);
    expect(result.byWalkTicks).toEqual({});
  });

  it('filters by date range', async () => {
    const result = await aggregateBloatDowns({
      startTime: ['>=', new Date('2024-01-02')],
    });
    expect(result.totalDowns).toBe(5);
  });

  it('combines mode and down number filters', async () => {
    const result = await aggregateBloatDowns({
      mode: [ChallengeMode.TOB_HARD],
      downNumber: ['==', 1],
    });

    expect(result.totalDowns).toBe(1);
    expect(result.byWalkTicks['39']).toBe(1);
  });

  it('returns empty when no challenges match', async () => {
    const result = await aggregateBloatDowns({
      mode: [ChallengeMode.TOB_ENTRY],
    });
    expect(result.totalDowns).toBe(0);
    expect(result.byWalkTicks).toEqual({});
  });
});
