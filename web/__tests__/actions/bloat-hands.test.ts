import { ChallengeMode, ChallengeStatus, ChallengeType } from '@blert/common';

import { sql } from '@/actions/db';
import { aggregateBloatHands, BloatHandsQuery } from '@/actions/challenge';

describe('aggregateBloatHands', () => {
  let challengeIds: number[];
  let playerIds: number[];

  beforeEach(async () => {
    // Create test players
    const players = [
      {
        username: 'Player1',
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
      {
        username: 'Player2',
        total_recordings: 3,
        overall_experience: 150_000_000,
        attack_experience: 10_000_000,
        defence_experience: 10_000_000,
        strength_experience: 10_000_000,
        hitpoints_experience: 10_000_000,
        ranged_experience: 10_000_000,
        prayer_experience: 10_000_000,
        magic_experience: 10_000_000,
      },
    ];

    const playerResults =
      await sql`INSERT INTO players ${sql(players)} RETURNING id`;
    playerIds = playerResults.map((r) => r.id);

    // Create test challenges
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
        scale: 3,
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
        status: ChallengeStatus.WIPED,
        scale: 2,
        challenge_ticks: 800,
        overall_ticks: 800,
        total_deaths: 5,
      },
    ];

    const challengeResults =
      await sql`INSERT INTO challenges ${sql(challenges)} RETURNING id`;
    challengeIds = challengeResults.map((r) => r.id);

    // Create challenge players
    const challengePlayers = [
      // Challenge 1 (duo)
      {
        challenge_id: challengeIds[0],
        player_id: playerIds[0],
        username: 'Player1',
        orb: 0,
        primary_gear: 1,
      },
      {
        challenge_id: challengeIds[0],
        player_id: playerIds[1],
        username: 'Player2',
        orb: 1,
        primary_gear: 1,
      },
      // Challenge 2 (trio)
      {
        challenge_id: challengeIds[1],
        player_id: playerIds[0],
        username: 'Player1',
        orb: 0,
        primary_gear: 1,
      },
      {
        challenge_id: challengeIds[1],
        player_id: playerIds[1],
        username: 'Player2',
        orb: 1,
        primary_gear: 1,
      },
      {
        challenge_id: challengeIds[1],
        player_id: playerIds[0],
        username: 'Player1',
        orb: 2,
        primary_gear: 1,
      }, // Player1 in both slots for trio
      // Challenge 3 (duo)
      {
        challenge_id: challengeIds[2],
        player_id: playerIds[0],
        username: 'Player1',
        orb: 0,
        primary_gear: 1,
      },
      {
        challenge_id: challengeIds[2],
        player_id: playerIds[1],
        username: 'Player2',
        orb: 1,
        primary_gear: 1,
      },
      // Challenge 4 (duo)
      {
        challenge_id: challengeIds[3],
        player_id: playerIds[0],
        username: 'Player1',
        orb: 0,
        primary_gear: 1,
      },
      {
        challenge_id: challengeIds[3],
        player_id: playerIds[1],
        username: 'Player2',
        orb: 1,
        primary_gear: 1,
      },
    ];

    await sql`INSERT INTO challenge_players ${sql(challengePlayers)}`;

    // Create bloat hands data
    const bloatHands = [
      // Challenge 1, Wave 1
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
      // Challenge 1, Wave 2
      {
        challenge_id: challengeIds[0],
        wave_number: 2,
        tile_id: 50,
        chunk: 3,
        intra_chunk_order: 0,
      },
      {
        challenge_id: challengeIds[0],
        wave_number: 2,
        tile_id: 34,
        chunk: 2,
        intra_chunk_order: 0,
      },

      // Challenge 2, Wave 1
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
      {
        challenge_id: challengeIds[1],
        wave_number: 1,
        tile_id: 200,
        chunk: 3,
        intra_chunk_order: 0,
      },

      // Challenge 3, Wave 1 (hard mode)
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

      // Challenge 4, Wave 1
      {
        challenge_id: challengeIds[3],
        wave_number: 1,
        tile_id: 17,
        chunk: 1,
        intra_chunk_order: 0,
      },

      // Some failed spawns (NULL tile_id)
      {
        challenge_id: challengeIds[0],
        wave_number: 3,
        tile_id: null,
        chunk: 0,
        intra_chunk_order: 0,
      },
      {
        challenge_id: challengeIds[1],
        wave_number: 2,
        tile_id: null,
        chunk: 1,
        intra_chunk_order: 0,
      },
    ];

    await sql`INSERT INTO bloat_hands ${sql(bloatHands)}`;
  });

  afterEach(async () => {
    await sql`DELETE FROM bloat_hands`;
    await sql`DELETE FROM challenge_players`;
    await sql`DELETE FROM challenges`;
    await sql`DELETE FROM players`;
  });

  afterAll(async () => {
    await sql.end();
  });

  describe('total view', () => {
    it('aggregates total hands per tile across all challenges', async () => {
      const query: BloatHandsQuery = {};
      const result = await aggregateBloatHands(query, 'total');

      expect(result).not.toBeNull();
      expect(result!.totalChallenges).toBe(4); // Includes completed and wiped
      expect(result!.totalHands).toBe(11); // Excludes null tile_ids
      expect(result!.data.view).toBe('total');

      const data = result!.data;
      expect(data.view).toBe('total');
      if (data.view === 'total') {
        expect(data.byTile['17']).toBe(6); // Tile 17 appears in multiple challenges
        expect(data.byTile['34']).toBe(2);
        expect(data.byTile['50']).toBe(1);
        expect(data.byTile['100']).toBe(1);
        expect(data.byTile['200']).toBe(1);
      }
    });

    it('filters by challenge mode', async () => {
      const query: BloatHandsQuery = {
        mode: [ChallengeMode.TOB_HARD],
      };
      const result = await aggregateBloatHands(query, 'total');

      expect(result).not.toBeNull();
      expect(result!.totalChallenges).toBe(1); // Only hard mode
      expect(result!.totalHands).toBe(2);
      const data = result!.data;
      if (data.view === 'total') {
        expect(data.byTile['17']).toBe(2);
      }
    });

    it('filters by party size', async () => {
      const query: BloatHandsQuery = {
        party: ['Player1', 'Player2'], // Duo only
      };
      const result = await aggregateBloatHands(query, 'total');

      expect(result).not.toBeNull();
      expect(result!.totalChallenges).toBe(3); // Duos
      expect(result!.totalHands).toBe(8);
    });

    it('filters by date range', async () => {
      const query: BloatHandsQuery = {
        startTime: ['>=', new Date('2024-01-02')],
      };
      const result = await aggregateBloatHands(query, 'total');

      expect(result).not.toBeNull();
      expect(result!.totalChallenges).toBe(3); // Excludes first challenge
      expect(result!.totalHands).toBe(6);
    });
  });

  describe('wave view', () => {
    it('aggregates hands by wave and tile', async () => {
      const query: BloatHandsQuery = {};
      const result = await aggregateBloatHands(query, 'wave');

      expect(result).not.toBeNull();
      expect(result!.data.view).toBe('wave');

      const data = result!.data;
      if (data.view === 'wave') {
        expect(data.byWave['1']['17']).toBe(6); // Tile 17 in wave 1
        expect(data.byWave['1']['34']).toBe(1);
        expect(data.byWave['1']['100']).toBe(1);
        expect(data.byWave['1']['200']).toBe(1);
        expect(data.byWave['2']['50']).toBe(1);
        expect(data.byWave['2']['34']).toBe(1);
      }
    });

    it('filters by specific wave', async () => {
      const query: BloatHandsQuery = {
        wave: ['==', 1],
      };
      const result = await aggregateBloatHands(query, 'wave');

      expect(result).not.toBeNull();
      expect(result!.totalHands).toBe(9); // Only wave 1 hands

      const data = result!.data;
      if (data.view === 'wave') {
        expect(Object.keys(data.byWave)).toEqual(['1']); // Only wave 1
        expect(data.byWave['1']['17']).toBe(6);
      }
    });

    it('filters by wave range', async () => {
      const query: BloatHandsQuery = {
        wave: ['range', [1, 3]],
      };
      const result = await aggregateBloatHands(query, 'wave');

      expect(result).not.toBeNull();
      expect(result!.totalHands).toBe(11); // Waves 1 and 2

      const data = result!.data;
      if (data.view === 'wave') {
        expect(Object.keys(data.byWave).sort()).toEqual(['1', '2']); // Waves 1 and 2
      }
    });
  });

  describe('chunk view', () => {
    it('aggregates hands by chunk', async () => {
      const query: BloatHandsQuery = {};
      const result = await aggregateBloatHands(query, 'chunk');

      expect(result).not.toBeNull();
      expect(result!.data.view).toBe('chunk');
      expect(result!.totalHands).toBe(13); // Includes null tile_ids

      const data = result!.data;
      if (data.view === 'chunk') {
        expect(data.byChunk['0']).toBe(1); // Failed spawn
        expect(data.byChunk['1']).toBe(7); // Multiple hands in chunk 1
        expect(data.byChunk['2']).toBe(3);
        expect(data.byChunk['3']).toBe(2); // Tile 50 and tile 200
      }
    });

    it('filters by specific chunk', async () => {
      const query: BloatHandsQuery = {
        chunk: ['==', 1],
      };
      const result = await aggregateBloatHands(query, 'chunk');

      expect(result).not.toBeNull();
      expect(result!.totalHands).toBe(7); // Only chunk 1

      const data = result!.data;
      if (data.view === 'chunk') {
        expect(Object.keys(data.byChunk)).toEqual(['1']);
        expect(data.byChunk['1']).toBe(7);
      }
    });
  });

  describe('intraChunkOrder view', () => {
    it('aggregates hands by intra-chunk order and tile', async () => {
      const query: BloatHandsQuery = {};
      const result = await aggregateBloatHands(query, 'intraChunkOrder');

      expect(result).not.toBeNull();
      expect(result!.data.view).toBe('intraChunkOrder');

      const data = result!.data;
      if (data.view === 'intraChunkOrder') {
        expect(data.byOrder['0']['17']).toBe(4); // First hands on tile 17
        expect(data.byOrder['0']['34']).toBe(2); // First hands on tile 34
        expect(data.byOrder['0']['100']).toBe(1);
        expect(data.byOrder['0']['200']).toBe(1);
        expect(data.byOrder['0']['50']).toBe(1);
        expect(data.byOrder['1']['17']).toBe(2); // Second hands on tile 17
      }
    });

    it('filters by specific intra-chunk order', async () => {
      const query: BloatHandsQuery = {
        intraChunkOrder: ['==', 0],
      };
      const result = await aggregateBloatHands(query, 'intraChunkOrder');

      expect(result).not.toBeNull();
      expect(result!.totalHands).toBe(9); // Only first hands in chunks

      const data = result!.data;
      if (data.view === 'intraChunkOrder') {
        expect(Object.keys(data.byOrder)).toEqual(['0']);
        expect(data.byOrder['0']['17']).toBe(4);
      }
    });
  });

  describe('complex filtering', () => {
    it('combines multiple filters', async () => {
      const query: BloatHandsQuery = {
        mode: [ChallengeMode.TOB_REGULAR],
        wave: ['==', 1],
        chunk: ['==', 1],
      };
      const result = await aggregateBloatHands(query, 'total');

      expect(result).not.toBeNull();
      expect(result!.totalChallenges).toBe(3); // Regular mode
      expect(result!.totalHands).toBe(4); // Only wave 1, chunk 1 hands
      const data = result!.data;
      if (data.view === 'total') {
        expect(data.byTile['17']).toBe(4);
      }
    });

    it('filters by challenge status - completed only', async () => {
      const query: BloatHandsQuery = {
        status: ['==', ChallengeStatus.COMPLETED],
      };
      const result = await aggregateBloatHands(query, 'total');

      expect(result).not.toBeNull();
      expect(result!.totalChallenges).toBe(3); // Only completed challenges
      expect(result!.totalHands).toBe(10); // Excludes wiped challenge
      const data = result!.data;
      if (data.view === 'total') {
        expect(data.byTile['17']).toBe(5); // Tile 17 without wiped challenge
        expect(data.byTile['34']).toBe(2);
        expect(data.byTile['50']).toBe(1);
        expect(data.byTile['100']).toBe(1);
        expect(data.byTile['200']).toBe(1);
      }
    });
  });

  describe('edge cases', () => {
    it('returns empty result when no challenges match', async () => {
      const query: BloatHandsQuery = {
        mode: [ChallengeMode.TOB_ENTRY], // No entry mode challenges
      };
      const result = await aggregateBloatHands(query, 'total');

      expect(result).toEqual({
        totalChallenges: 0,
        totalHands: 0,
        data: {
          view: 'total',
          byTile: {},
        },
      });
    });

    it('returns null when query is invalid', async () => {
      const query: BloatHandsQuery = {
        party: [], // Empty party array should return null
      };
      const result = await aggregateBloatHands(query, 'total');

      expect(result).toBeNull();
    });

    it('excludes challenges with no bloat hands data', async () => {
      // Add a challenge with no bloat hands
      const [challengeResult] = await sql`
        INSERT INTO challenges (uuid, start_time, type, mode, status, scale)
        VALUES ('55555555-5555-5555-5555-555555555555', ${new Date('2024-01-05')}, ${ChallengeType.TOB}, ${ChallengeMode.TOB_REGULAR}, ${ChallengeStatus.COMPLETED}, 2)
        RETURNING id
      `;

      await sql`
        INSERT INTO challenge_players (challenge_id, player_id, username, orb, primary_gear)
        VALUES (${challengeResult.id as number}, ${playerIds[0]}, 'Player1', 0, 1)
      `;

      const query: BloatHandsQuery = {};
      const result = await aggregateBloatHands(query, 'total');

      expect(result).not.toBeNull();
      expect(result!.totalChallenges).toBe(4); // Still only the original 4 challenges with bloat data
    });
  });
});
