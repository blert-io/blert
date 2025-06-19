import {
  ChallengeMode,
  ChallengeStatus,
  ChallengeType,
  SessionStatus,
  partyHash,
} from '@blert/common';

import { aggregateSessions, SessionQuery } from '@/actions/challenge';
import { sql } from '@/actions/db';

describe('aggregateSessions', () => {
  let playerIds: number[];
  let sessionIds: number[];
  let partyHash1: string;
  let partyHash2: string;
  let partyHash3: string;

  beforeEach(async () => {
    const players = [
      { username: 'PlayerA' },
      { username: 'PlayerB' },
      { username: 'PlayerC' },
    ];
    const playerResults = await sql`
      INSERT INTO players ${sql(players, ['username'])} RETURNING id
    `;
    playerIds = playerResults.map((p) => p.id);

    const party1 = ['PlayerA', 'PlayerB'];
    const party2 = ['PlayerA', 'PlayerB', 'PlayerC'];
    const party3 = ['PlayerA'];
    partyHash1 = partyHash(party1);
    partyHash2 = partyHash(party2);
    partyHash3 = partyHash(party3);

    const sessions = [
      // 0: ToB duo, completed, 1hr duration
      {
        uuid: '11111111-1111-1111-1111-111111111111',
        challenge_type: ChallengeType.TOB,
        challenge_mode: ChallengeMode.TOB_REGULAR,
        scale: 2,
        party_hash: partyHash1,
        start_time: new Date('2024-01-01T10:00:00Z'),
        end_time: new Date('2024-01-01T11:00:00Z'),
        status: SessionStatus.COMPLETED,
      },
      // 1: ToB trio, active, 15min duration
      {
        uuid: '22222222-2222-2222-2222-222222222222',
        challenge_type: ChallengeType.TOB,
        challenge_mode: ChallengeMode.TOB_HARD,
        scale: 3,
        party_hash: partyHash2,
        start_time: new Date('2024-01-02T12:00:00Z'),
        end_time: new Date('2024-01-02T12:15:00Z'),
        status: SessionStatus.ACTIVE,
      },
      // 2: Colosseum solo, completed, 30min duration
      {
        uuid: '33333333-3333-3333-3333-333333333333',
        challenge_type: ChallengeType.COLOSSEUM,
        challenge_mode: ChallengeMode.NO_MODE,
        scale: 1,
        party_hash: partyHash3,
        start_time: new Date('2024-01-03T15:00:00Z'),
        end_time: new Date('2024-01-03T15:30:00Z'),
        status: SessionStatus.COMPLETED,
      },
      // 3: ToB duo (same party as 0), wiped, 45min duration
      {
        uuid: '44444444-4444-4444-4444-444444444444',
        challenge_type: ChallengeType.TOB,
        challenge_mode: ChallengeMode.TOB_REGULAR,
        scale: 2,
        party_hash: partyHash1,
        start_time: new Date('2024-01-04T10:00:00Z'),
        end_time: new Date('2024-01-04T10:45:00Z'),
        status: SessionStatus.COMPLETED,
      },
      // 4: Hidden session
      {
        uuid: '55555555-5555-5555-5555-555555555555',
        challenge_type: ChallengeType.TOB,
        challenge_mode: ChallengeMode.TOB_REGULAR,
        scale: 2,
        party_hash: partyHash1,
        start_time: new Date('2024-01-05T10:00:00Z'),
        end_time: new Date('2024-01-05T11:00:00Z'),
        status: SessionStatus.HIDDEN,
      },
    ];
    const sessionResults = await sql<[{ id: number }]>`
      INSERT INTO challenge_sessions ${sql(sessions)} RETURNING id
    `;
    sessionIds = sessionResults.map((s) => s.id);

    const challenges = [
      // Session 0: 2 completed
      {
        session_id: sessionIds[0],
        uuid: '11111111-1111-1111-1111-111111111111',
        type: ChallengeType.TOB,
        status: ChallengeStatus.COMPLETED,
        start_time: new Date(),
        scale: 2,
      },
      {
        session_id: sessionIds[0],
        uuid: '22222222-2222-2222-2222-222222222222',
        type: ChallengeType.TOB,
        status: ChallengeStatus.COMPLETED,
        start_time: new Date(),
        scale: 2,
      },
      // Session 1: 1 completed, 1 wiped
      {
        session_id: sessionIds[1],
        uuid: '33333333-3333-3333-3333-333333333333',
        type: ChallengeType.TOB,
        status: ChallengeStatus.COMPLETED,
        start_time: new Date(),
        scale: 3,
      },
      {
        session_id: sessionIds[1],
        uuid: '44444444-4444-4444-4444-444444444444',
        type: ChallengeType.TOB,
        status: ChallengeStatus.WIPED,
        start_time: new Date(),
        scale: 3,
      },
      // Session 2: 1 completed
      {
        session_id: sessionIds[2],
        uuid: '55555555-5555-5555-5555-555555555555',
        type: ChallengeType.COLOSSEUM,
        status: ChallengeStatus.COMPLETED,
        start_time: new Date(),
        scale: 1,
      },
      // Session 3: 1 wiped, 1 abandoned (not counted)
      {
        session_id: sessionIds[3],
        uuid: '66666666-6666-6666-6666-666666666666',
        type: ChallengeType.TOB,
        status: ChallengeStatus.ABANDONED,
        start_time: new Date(),
        scale: 2,
      },
      {
        session_id: sessionIds[3],
        uuid: '77777777-7777-7777-7777-777777777777',
        type: ChallengeType.TOB,
        status: ChallengeStatus.WIPED,
        start_time: new Date(),
        scale: 2,
      },
    ];
    const challengeResults = await sql`
      INSERT INTO challenges ${sql(challenges, [
        'session_id',
        'uuid',
        'type',
        'status',
        'start_time',
        'scale',
      ])} RETURNING id
    `;
    const challengeIds = challengeResults.map((c) => c.id);

    const challengePlayers = [
      // Session 0, first challenge (for party hash lookup)
      {
        challenge_id: challengeIds[0],
        player_id: playerIds[0],
        username: 'PlayerA',
        orb: 0,
        primary_gear: 0,
      },
      {
        challenge_id: challengeIds[0],
        player_id: playerIds[1],
        username: 'PlayerB',
        orb: 1,
        primary_gear: 0,
      },
      // Session 1, first challenge
      {
        challenge_id: challengeIds[2],
        player_id: playerIds[0],
        username: 'PlayerA',
        orb: 0,
        primary_gear: 0,
      },
      {
        challenge_id: challengeIds[2],
        player_id: playerIds[1],
        username: 'PlayerB',
        orb: 1,
        primary_gear: 0,
      },
      {
        challenge_id: challengeIds[2],
        player_id: playerIds[2],
        username: 'PlayerC',
        orb: 2,
        primary_gear: 0,
      },
      // Session 2, first challenge
      {
        challenge_id: challengeIds[4],
        player_id: playerIds[0],
        username: 'PlayerA',
        orb: 0,
        primary_gear: 0,
      },
      // Session 3, both challenges (first is abandoned)
      {
        challenge_id: challengeIds[5],
        player_id: playerIds[0],
        username: 'PlayerA',
        orb: 0,
        primary_gear: 0,
      },
      {
        challenge_id: challengeIds[5],
        player_id: playerIds[1],
        username: 'PlayerB',
        orb: 1,
        primary_gear: 0,
      },
      {
        challenge_id: challengeIds[6],
        player_id: playerIds[0],
        username: 'PlayerA',
        orb: 0,
        primary_gear: 0,
      },
      {
        challenge_id: challengeIds[6],
        player_id: playerIds[1],
        username: 'PlayerB',
        orb: 1,
        primary_gear: 0,
      },
    ];
    await sql`
      INSERT INTO challenge_players ${sql(challengePlayers, [
        'challenge_id',
        'player_id',
        'username',
        'orb',
        'primary_gear',
      ])}
    `;
  });

  afterEach(async () => {
    await sql`DELETE FROM challenge_players`;
    await sql`DELETE FROM challenges`;
    await sql`DELETE FROM challenge_sessions`;
    await sql`DELETE FROM players`;
  });

  afterAll(async () => {
    await sql.end();
  });

  describe('basic aggregations', () => {
    it('should aggregate count and duration for all non-hidden sessions', async () => {
      const query: SessionQuery = {};
      const result = await aggregateSessions(query, {
        '*': 'count',
        duration: ['sum', 'avg', 'min', 'max'],
        challenges: ['sum', 'avg'],
      });

      expect(result).not.toBeNull();
      expect(result!['*'].count).toBe(4);
      // Durations: 3600, 2700, 1800, 900.
      expect(result!.duration.sum).toBe(3600 + 2700 + 1800 + 900);
      expect(result!.duration.avg).toBeCloseTo((3600 + 2700 + 1800 + 900) / 4);
      expect(result!.duration.min).toBe(900);
      expect(result!.duration.max).toBe(3600);
      // Challenges (non-abandoned): 2, 2, 1, 1 -> sum=6, avg=1.5
      expect(result!.challenges.sum).toBe(6);
      expect(result!.challenges.avg).toBe(1.5);
    });
  });

  describe('filtering', () => {
    it('should filter by session status', async () => {
      const query: SessionQuery = { status: ['==', SessionStatus.COMPLETED] };
      const result = await aggregateSessions(query, { '*': 'count' });
      expect(result!['*'].count).toBe(3);
    });

    it('should filter by challenge type', async () => {
      const query: SessionQuery = { type: ['==', ChallengeType.COLOSSEUM] };
      const result = await aggregateSessions(query, { '*': 'count' });
      expect(result!['*'].count).toBe(1);
    });
  });

  describe('grouping', () => {
    it('should group by challenge mode', async () => {
      const query: SessionQuery = {};
      const result = await aggregateSessions(
        query,
        { '*': 'count' },
        {},
        'mode',
      );

      expect(result).not.toBeNull();
      const regular = ChallengeMode.TOB_REGULAR.toString();
      const hard = ChallengeMode.TOB_HARD.toString();
      const colo = ChallengeMode.NO_MODE.toString();
      expect(result![regular]['*'].count).toBe(2);
      expect(result![hard]['*'].count).toBe(1);
      expect(result![colo]['*'].count).toBe(1);
    });

    it('should group by party and return usernames', async () => {
      const query: SessionQuery = {};
      const result = await aggregateSessions(
        query,
        { '*': 'count' },
        {},
        'party',
      );

      expect(result).not.toBeNull();
      const party1Usernames = 'PlayerA,PlayerB';
      const party2Usernames = 'PlayerA,PlayerB,PlayerC';
      const party3Usernames = 'PlayerA';

      expect(Object.keys(result!)).toHaveLength(3);
      expect(result![party1Usernames]['*'].count).toBe(2);
      expect(result![party2Usernames]['*'].count).toBe(1);
      expect(result![party3Usernames]['*'].count).toBe(1);
    });

    it('should group by multiple fields', async () => {
      const query: SessionQuery = {};
      const result = await aggregateSessions(query, { '*': 'count' }, {}, [
        'type',
        'scale',
      ] as const);

      expect(result).not.toBeNull();
      const tob = ChallengeType.TOB.toString();
      const colo = ChallengeType.COLOSSEUM.toString();

      expect(result![tob]['2']['*'].count).toBe(2);
      expect(result![tob]['3']['*'].count).toBe(1);
      expect(result![colo]['1']['*'].count).toBe(1);
    });
  });

  describe('sorting and limiting', () => {
    it('should sort by an aggregated field', async () => {
      const query: SessionQuery = {};
      const result = await aggregateSessions(
        query,
        { duration: 'max' },
        { sort: '-duration:max', limit: 2 },
        'scale',
      );

      expect(Object.keys(result!)).toHaveLength(2);
      expect(result!['2'].duration.max).toBe(3600);
      expect(result!['1'].duration.max).toBe(1800);
    });

    it('should limit the number of results', async () => {
      const query: SessionQuery = {};
      const result = await aggregateSessions(
        query,
        { '*': 'count' },
        { limit: 2 },
        'scale',
      );

      expect(Object.keys(result!)).toHaveLength(2);
    });
  });
});
