import {
  ChallengeMode,
  ChallengeStatus,
  ChallengeType,
  Stage,
  SessionStatus,
  normalizeRsn,
  partyHash,
} from '@blert/common';

import {
  aggregateSessions,
  findChallenges,
  loadSessionsPage,
  loadSessionWithStats,
  SessionQuery,
} from '@/actions/challenge';
import { sql } from '@/actions/db';

afterAll(async () => {
  await sql.end();
});

describe('sessions', () => {
  let playerIds: number[];
  let sessionIds: number[];
  let partyHash1: string;
  let partyHash2: string;
  let partyHash3: string;

  beforeEach(async () => {
    const players = [
      { username: 'PlayerA', normalized_username: normalizeRsn('PlayerA') },
      { username: 'PlayerB', normalized_username: normalizeRsn('PlayerB') },
      { username: 'PlayerC', normalized_username: normalizeRsn('PlayerC') },
    ];
    const playerResults = await sql`
      INSERT INTO players ${sql(players, ['username', 'normalized_username'])} RETURNING id
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
      // Session 0, both challenges
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
      {
        challenge_id: challengeIds[1],
        player_id: playerIds[0],
        username: 'PlayerA',
        orb: 0,
        primary_gear: 0,
      },
      {
        challenge_id: challengeIds[1],
        player_id: playerIds[1],
        username: 'PlayerB',
        orb: 1,
        primary_gear: 0,
      },
      // Session 1, both challenges
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
      {
        challenge_id: challengeIds[3],
        player_id: playerIds[0],
        username: 'PlayerA',
        orb: 0,
        primary_gear: 0,
      },
      {
        challenge_id: challengeIds[3],
        player_id: playerIds[1],
        username: 'PlayerB',
        orb: 1,
        primary_gear: 0,
      },
      {
        challenge_id: challengeIds[3],
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

  describe('aggregateSessions', () => {
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
        expect(result!.duration.avg).toBeCloseTo(
          (3600 + 2700 + 1800 + 900) / 4,
        );
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

  describe('loadSessionsPage', () => {
    const COMPLETED_2_CHALLENGES = '11111111-1111-1111-1111-111111111111';
    const ACTIVE_2_CHALLENGES = '22222222-2222-2222-2222-222222222222';
    const COMPLETED_1_CHALLENGE = '33333333-3333-3333-3333-333333333333';
    const COMPLETED_1_WIPE_1_ABANDON = '44444444-4444-4444-4444-444444444444';

    describe('challengeCount filter', () => {
      it('returns sessions with exactly N non-abandoned challenges', async () => {
        const page = await loadSessionsPage(20, {
          challengeCount: ['==', 2],
        });
        expect(page.sessions.map((s) => s.uuid)).toEqual([
          ACTIVE_2_CHALLENGES,
          COMPLETED_2_CHALLENGES,
        ]);
        expect(page.total).toBe(2);
        expect(page.remaining).toBe(0);
      });

      it('excludes abandoned challenges from the count', async () => {
        const page = await loadSessionsPage(20, {
          challengeCount: ['==', 1],
        });
        expect(page.sessions.map((s) => s.uuid)).toEqual([
          COMPLETED_1_WIPE_1_ABANDON,
          COMPLETED_1_CHALLENGE,
        ]);
        expect(page.total).toBe(2);
      });

      it('supports greater-than-or-equal', async () => {
        const page = await loadSessionsPage(20, {
          challengeCount: ['>=', 2],
        });
        expect(page.sessions.map((s) => s.uuid)).toEqual([
          ACTIVE_2_CHALLENGES,
          COMPLETED_2_CHALLENGES,
        ]);
      });

      it('supports less-than-or-equal', async () => {
        const page = await loadSessionsPage(20, {
          challengeCount: ['<=', 1],
        });
        expect(page.sessions.map((s) => s.uuid)).toEqual([
          COMPLETED_1_WIPE_1_ABANDON,
          COMPLETED_1_CHALLENGE,
        ]);
      });

      it('supports a half-open range spread', async () => {
        const page = await loadSessionsPage(20, {
          challengeCount: ['range', [1, 3]],
        });
        expect(page.sessions.map((s) => s.uuid)).toEqual([
          ACTIVE_2_CHALLENGES,
          COMPLETED_1_WIPE_1_ABANDON,
          COMPLETED_1_CHALLENGE,
          COMPLETED_2_CHALLENGES,
        ]);
        expect(page.total).toBe(4);
      });

      it('returns no sessions when the count matches nothing', async () => {
        const page = await loadSessionsPage(20, {
          challengeCount: ['>=', 3],
        });
        expect(page.sessions).toEqual([]);
        expect(page.total).toBe(0);
      });

      it('composes with other filters', async () => {
        const page = await loadSessionsPage(20, {
          challengeCount: ['==', 2],
          status: ['==', SessionStatus.COMPLETED],
        });
        expect(page.sessions.map((s) => s.uuid)).toEqual([
          COMPLETED_2_CHALLENGES,
        ]);
        expect(page.total).toBe(1);
      });
    });

    describe('duration filter', () => {
      it('filters by minimum duration in seconds', async () => {
        const page = await loadSessionsPage(20, {
          duration: ['>=', 2700],
        });
        expect(page.sessions.map((s) => s.uuid)).toEqual([
          COMPLETED_1_WIPE_1_ABANDON,
          COMPLETED_2_CHALLENGES,
        ]);
      });

      it('filters by maximum duration', async () => {
        const page = await loadSessionsPage(20, {
          duration: ['<=', 1800],
        });
        expect(page.sessions.map((s) => s.uuid)).toEqual([
          ACTIVE_2_CHALLENGES,
          COMPLETED_1_CHALLENGE,
        ]);
      });

      it('excludes sessions with null end_time', async () => {
        await sql`
          UPDATE challenge_sessions
          SET end_time = NULL
          WHERE uuid = ${ACTIVE_2_CHALLENGES}
        `;
        const page = await loadSessionsPage(20, {
          duration: ['>=', 1],
        });
        expect(page.sessions.map((s) => s.uuid)).not.toContain(
          ACTIVE_2_CHALLENGES,
        );
        expect(page.sessions).toHaveLength(3);
      });

      it('supports a range', async () => {
        const page = await loadSessionsPage(20, {
          duration: ['range', [1800, 3600]],
        });
        expect(page.sessions.map((s) => s.uuid)).toEqual([
          COMPLETED_1_WIPE_1_ABANDON,
          COMPLETED_1_CHALLENGE,
        ]);
      });
    });
  });

  describe('loadSessionWithStats', () => {
    const SESSION_UUID = '11111111-1111-1111-1111-111111111111';
    const CHALLENGE_WITH_DOWNS_UUID = '11111111-1111-1111-1111-111111111111';
    const CHALLENGE_WITHOUT_DOWNS_UUID = '22222222-2222-2222-2222-222222222222';

    let withDownsId: number;
    let withoutDownsId: number;

    beforeEach(async () => {
      const rows = await sql<{ id: number; uuid: string }[]>`
        SELECT id, uuid FROM challenges
        WHERE uuid IN (
          ${CHALLENGE_WITH_DOWNS_UUID},
          ${CHALLENGE_WITHOUT_DOWNS_UUID}
        )
      `;
      const byUuid = new Map(rows.map((r) => [r.uuid, r.id]));
      withDownsId = byUuid.get(CHALLENGE_WITH_DOWNS_UUID)!;
      withoutDownsId = byUuid.get(CHALLENGE_WITHOUT_DOWNS_UUID)!;

      await sql`
        INSERT INTO tob_challenge_stats ${sql([
          { challenge_id: withDownsId, bloat_down_count: 3 },
          { challenge_id: withoutDownsId, bloat_down_count: 0 },
        ])}
      `;

      await sql`
        INSERT INTO bloat_downs ${sql([
          {
            challenge_id: withDownsId,
            down_number: 1,
            down_tick: 40,
            walk_ticks: 40,
            accurate: true,
          },
          {
            challenge_id: withDownsId,
            down_number: 2,
            down_tick: 80,
            walk_ticks: 35,
            accurate: true,
          },
          {
            challenge_id: withDownsId,
            down_number: 3,
            down_tick: 120,
            walk_ticks: 38,
            accurate: false,
          },
        ])}
      `;
    });

    it('attaches bloat downs to the matching challenge', async () => {
      const session = await loadSessionWithStats(SESSION_UUID);
      expect(session).not.toBeNull();
      expect(session!.challenges).toHaveLength(2);

      const withDowns = session!.challenges.find(
        (c) => c.uuid === CHALLENGE_WITH_DOWNS_UUID,
      );
      expect(withDowns).toBeDefined();
      expect(withDowns!.tobStats).toBeDefined();
      expect(withDowns!.tobStats!.bloatDownCount).toBe(3);
      expect(withDowns!.tobStats!.downs).toEqual([
        { downNumber: 1, downTick: 40, walkTicks: 40, accurate: true },
        { downNumber: 2, downTick: 80, walkTicks: 35, accurate: true },
        { downNumber: 3, downTick: 120, walkTicks: 38, accurate: false },
      ]);
    });

    it('returns an empty downs array for challenges without bloat_downs rows', async () => {
      const session = await loadSessionWithStats(SESSION_UUID);
      const withoutDowns = session!.challenges.find(
        (c) => c.uuid === CHALLENGE_WITHOUT_DOWNS_UUID,
      );

      expect(withoutDowns).toBeDefined();
      expect(withoutDowns!.tobStats).toBeDefined();
      expect(withoutDowns!.tobStats!.bloatDownCount).toBe(0);
      expect(withoutDowns!.tobStats!.downs).toEqual([]);
    });

    it('orders downs by down_number ascending regardless of insertion order', async () => {
      // Add two more rows for the other challenge in reversed order.
      await sql`
        INSERT INTO bloat_downs ${sql([
          {
            challenge_id: withoutDownsId,
            down_number: 2,
            down_tick: 90,
            walk_ticks: 45,
            accurate: true,
          },
          {
            challenge_id: withoutDownsId,
            down_number: 1,
            down_tick: 45,
            walk_ticks: 45,
            accurate: true,
          },
        ])}
      `;

      const session = await loadSessionWithStats(SESSION_UUID);
      const challenge = session!.challenges.find(
        (c) => c.uuid === CHALLENGE_WITHOUT_DOWNS_UUID,
      )!;

      expect(challenge.tobStats!.downs!.map((d) => d.downNumber)).toEqual([
        1, 2,
      ]);
    });
  });
});

describe('findChallenges', () => {
  describe('bloat down filters', () => {
    let playerId: number;
    let sessionId: number;
    let zeroDownChallengeId: number;
    let oneDownChallengeId: number;

    beforeEach(async () => {
      [{ id: playerId }] = await sql<{ id: number }[]>`
        INSERT INTO players ${sql([
          {
            username: 'PlayerA',
            normalized_username: normalizeRsn('PlayerA'),
          },
        ])} RETURNING id
      `;

      [{ id: sessionId }] = await sql<{ id: number }[]>`
        INSERT INTO challenge_sessions ${sql([
          {
            uuid: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            challenge_type: ChallengeType.TOB,
            challenge_mode: ChallengeMode.TOB_REGULAR,
            scale: 2,
            party_hash: partyHash(['PlayerA']),
            start_time: new Date('2024-01-01T10:00:00Z'),
            end_time: new Date('2024-01-01T10:30:00Z'),
            status: SessionStatus.COMPLETED,
          },
        ])} RETURNING id
      `;

      const challenges = await sql<{ id: number }[]>`
        INSERT INTO challenges ${sql([
          {
            session_id: sessionId,
            uuid: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
            type: ChallengeType.TOB,
            mode: ChallengeMode.TOB_REGULAR,
            stage: Stage.TOB_BLOAT,
            status: ChallengeStatus.WIPED,
            start_time: new Date('2024-01-01T10:00:00Z'),
            finish_time: new Date('2024-01-01T10:10:00Z'),
            scale: 2,
            challenge_ticks: 600,
            overall_ticks: 650,
            total_deaths: 2,
          },
          {
            session_id: sessionId,
            uuid: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
            type: ChallengeType.TOB,
            mode: ChallengeMode.TOB_REGULAR,
            stage: Stage.TOB_VERZIK,
            status: ChallengeStatus.COMPLETED,
            start_time: new Date('2024-01-01T11:00:00Z'),
            finish_time: new Date('2024-01-01T11:20:00Z'),
            scale: 2,
            challenge_ticks: 1200,
            overall_ticks: 1250,
            total_deaths: 0,
          },
        ])} RETURNING id
      `;
      [zeroDownChallengeId, oneDownChallengeId] = challenges.map((c) => c.id);

      await sql`
        INSERT INTO challenge_players ${sql([
          {
            challenge_id: zeroDownChallengeId,
            player_id: playerId,
            username: 'PlayerA',
            orb: 0,
            primary_gear: 0,
          },
          {
            challenge_id: oneDownChallengeId,
            player_id: playerId,
            username: 'PlayerA',
            orb: 0,
            primary_gear: 0,
          },
        ])}
      `;

      await sql`
        INSERT INTO tob_challenge_stats ${sql([
          {
            challenge_id: zeroDownChallengeId,
            bloat_down_count: 0,
          },
          {
            challenge_id: oneDownChallengeId,
            bloat_down_count: 1,
          },
        ])}
      `;

      await sql`
        INSERT INTO bloat_downs ${sql([
          {
            challenge_id: oneDownChallengeId,
            down_number: 1,
            down_tick: 41,
            walk_ticks: 41,
            accurate: true,
          },
        ])}
      `;
    });

    afterEach(async () => {
      await sql`DELETE FROM challenge_players`;
      await sql`DELETE FROM challenges`;
      await sql`DELETE FROM challenge_sessions`;
      await sql`DELETE FROM players`;
    });

    it('matches zero-down raids for tob.bloatDownCount=eq0', async () => {
      const [challenges] = await findChallenges(10, {
        tob: { bloatDownCount: ['==', 0] },
      });

      expect(challenges).toHaveLength(1);
      expect(challenges[0].uuid).toBe('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
    });

    it('combines persisted down count and bloat down filters', async () => {
      const [challenges] = await findChallenges(10, {
        tob: {
          bloatDowns: new Map([[1, ['==', 41]]]),
          bloatDownCount: ['==', 1],
        },
      });

      expect(challenges).toHaveLength(1);
      expect(challenges[0].uuid).toBe('cccccccc-cccc-cccc-cccc-cccccccccccc');
    });
  });
});
