import {
  ChallengeMode,
  ChallengeStatus,
  ChallengeType,
  normalizeRsn,
  PrimaryMeleeGear,
} from '@blert/common';

import { getPlayersPerHour } from '@/actions/activity';
import { sql } from '@/actions/db';

afterAll(async () => {
  await sql.end();
});

describe('getPlayersPerHour', () => {
  const NOW = new Date('2026-10-30T15:20:00Z');

  beforeEach(async () => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW.getTime());

    const players = [
      { username: '1Ogp', normalized_username: normalizeRsn('1Ogp') },
      {
        username: 'WWWWWWWWWWQQ',
        normalized_username: normalizeRsn('WWWWWWWWWWQQ'),
      },
    ];
    const [ten, wq] = await sql<{ id: number }[]>`
      INSERT INTO players ${sql(players)} RETURNING id
    `;

    const challenge = (
      uuid: string,
      startTime: string,
      type: ChallengeType,
    ) => ({
      uuid,
      start_time: new Date(startTime),
      type,
      mode:
        type === ChallengeType.TOB
          ? ChallengeMode.TOB_REGULAR
          : ChallengeMode.NO_MODE,
      status: ChallengeStatus.COMPLETED,
      scale: type === ChallengeType.TOB ? 2 : 1,
      challenge_ticks: type === ChallengeType.TOB ? 1900 : 2600,
      total_deaths: 0,
    });
    const challenges = [
      // Same clock hour as the window's start, but before it.
      challenge(
        '11111111-1111-1111-1111-111111111111',
        '2026-10-29T15:10:00Z',
        ChallengeType.TOB,
      ),
      challenge(
        '22222222-2222-2222-2222-222222222222',
        '2026-10-29T15:30:00Z',
        ChallengeType.TOB,
      ),
      challenge(
        '33333333-3333-3333-3333-333333333333',
        '2026-10-29T18:45:00Z',
        ChallengeType.COLOSSEUM,
      ),
      challenge(
        '44444444-4444-4444-4444-444444444444',
        '2026-10-30T15:00:00Z',
        ChallengeType.TOB,
      ),
      challenge(
        '55555555-5555-5555-5555-555555555555',
        '2026-10-30T15:05:00Z',
        ChallengeType.TOB,
      ),
      // After the window's end.
      challenge(
        '66666666-6666-6666-6666-666666666666',
        '2026-10-30T15:30:00Z',
        ChallengeType.TOB,
      ),
    ];
    const ids = await sql<{ id: number }[]>`
      INSERT INTO challenges ${sql(challenges)} RETURNING id
    `;

    const challengePlayer = (challengeId: number, playerId: number) => ({
      challenge_id: challengeId,
      player_id: playerId,
      username: playerId === ten.id ? '1Ogp' : 'WWWWWWWWWWQQ',
      orb: playerId === ten.id ? 0 : 1,
      primary_gear: PrimaryMeleeGear.BLORVA,
    });
    const tobDuo = (challengeId: number) => [
      challengePlayer(challengeId, ten.id),
      challengePlayer(challengeId, wq.id),
    ];
    const challengePlayers = [
      ...tobDuo(ids[0].id),
      ...tobDuo(ids[1].id),
      challengePlayer(ids[2].id, ten.id),
      ...tobDuo(ids[3].id),
      ...tobDuo(ids[4].id),
      ...tobDuo(ids[5].id),
    ];
    await sql`INSERT INTO challenge_players ${sql(challengePlayers)}`;
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await sql`DELETE FROM challenges`;
    await sql`DELETE FROM players`;
  });

  it('counts distinct players per hour of the last 24 hours', async () => {
    expect(await getPlayersPerHour()).toEqual([
      2, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2,
    ]);
    expect(await getPlayersPerHour(ChallengeType.TOB)).toEqual([
      2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2,
    ]);
  });
});
