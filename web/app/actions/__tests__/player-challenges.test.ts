import {
  ChallengeMode,
  ChallengeStatus,
  ChallengeType,
  normalizeRsn,
  PrimaryMeleeGear,
} from '@blert/common';

import { sql } from '@/actions/db';
import { countUniquePlayersForType } from '@/actions/player-challenges';

afterAll(async () => {
  await sql.end();
});

describe('countUniquePlayersForType', () => {
  beforeEach(async () => {
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

    const challenges = [
      {
        uuid: '11111111-1111-1111-1111-111111111111',
        start_time: new Date('2026-03-01'),
        type: ChallengeType.TOB,
        mode: ChallengeMode.TOB_REGULAR,
        status: ChallengeStatus.COMPLETED,
        scale: 2,
        challenge_ticks: 1900,
        total_deaths: 0,
      },
      {
        uuid: '22222222-2222-2222-2222-222222222222',
        start_time: new Date('2026-03-02'),
        type: ChallengeType.TOB,
        mode: ChallengeMode.TOB_HARD,
        status: ChallengeStatus.WIPED,
        scale: 2,
        challenge_ticks: 1400,
        total_deaths: 2,
      },
      {
        uuid: '33333333-3333-3333-3333-333333333333',
        start_time: new Date('2026-03-03'),
        type: ChallengeType.COLOSSEUM,
        mode: ChallengeMode.NO_MODE,
        status: ChallengeStatus.COMPLETED,
        scale: 1,
        challenge_ticks: 2600,
        total_deaths: 0,
      },
      {
        uuid: '44444444-4444-4444-4444-444444444444',
        start_time: new Date('2026-03-04'),
        type: ChallengeType.COLOSSEUM,
        mode: ChallengeMode.NO_MODE,
        status: ChallengeStatus.ABANDONED,
        scale: 1,
        challenge_ticks: 300,
        total_deaths: 0,
      },
    ];
    const [tobRegular, tobHard, colosseum, colosseumAbandoned] = await sql<
      { id: number }[]
    >`
      INSERT INTO challenges ${sql(challenges)} RETURNING id
    `;

    const challengePlayers = [
      {
        challenge_id: tobRegular.id,
        player_id: ten.id,
        username: '1Ogp',
        orb: 0,
        primary_gear: PrimaryMeleeGear.BLORVA,
      },
      {
        challenge_id: tobRegular.id,
        player_id: wq.id,
        username: 'WWWWWWWWWWQQ',
        orb: 1,
        primary_gear: PrimaryMeleeGear.TORVA,
      },
      {
        challenge_id: tobHard.id,
        player_id: ten.id,
        username: '1Ogp',
        orb: 0,
        primary_gear: PrimaryMeleeGear.BLORVA,
      },
      {
        challenge_id: tobHard.id,
        player_id: wq.id,
        username: 'WWWWWWWWWWQQ',
        orb: 1,
        primary_gear: PrimaryMeleeGear.TORVA,
      },
      {
        challenge_id: colosseum.id,
        player_id: ten.id,
        username: '1Ogp',
        orb: 0,
        primary_gear: PrimaryMeleeGear.BLORVA,
      },
      {
        challenge_id: colosseumAbandoned.id,
        player_id: wq.id,
        username: 'WWWWWWWWWWQQ',
        orb: 0,
        primary_gear: PrimaryMeleeGear.TORVA,
      },
    ];
    await sql`INSERT INTO challenge_players ${sql(challengePlayers)}`;

    await sql`REFRESH MATERIALIZED VIEW mv_daily_player_challenges`;
  });

  afterEach(async () => {
    await sql`DELETE FROM challenges`;
    await sql`DELETE FROM players`;
    await sql`REFRESH MATERIALIZED VIEW mv_daily_player_challenges`;
  });

  it('counts each player once across days and modes', async () => {
    expect(await countUniquePlayersForType(ChallengeType.TOB)).toBe(2);
  });

  it('excludes players seen only in abandoned challenges', async () => {
    expect(await countUniquePlayersForType(ChallengeType.COLOSSEUM)).toBe(1);
  });
});
