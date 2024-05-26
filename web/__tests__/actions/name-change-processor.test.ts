import {
  ChallengeType,
  NameChange,
  NameChangeStatus,
  PlayerExperience,
  Skill,
} from '@blert/common';

import { sql } from '@/actions/db';
import { processNameChange } from '@/actions/name-change-processor';

jest.mock('@/auth', () => {
  return {
    __esModule: true,
    auth: jest.fn(),
  };
});

describe('processNameChange', () => {
  const arbitraryExperience: PlayerExperience = {
    [Skill.OVERALL]: 300_000_000,
    [Skill.ATTACK]: 7_000_000,
    [Skill.DEFENCE]: 7_000_000,
    [Skill.STRENGTH]: 7_000_000,
    [Skill.HITPOINTS]: 7_000_000,
    [Skill.RANGED]: 7_000_000,
    [Skill.PRAYER]: 7_000_000,
    [Skill.MAGIC]: 7_000_000,
  };

  let _fetch = global.fetch;
  let userId: number;
  let oldPlayerId: number;
  let newPlayerId: number;
  let otherPlayerId: number;
  let challengeSplits: Array<{
    id: number;
    type: number;
    scale: number;
    ticks: number;
  }>;

  beforeAll(async () => {
    const users = [
      { username: 'User 1', email: 'a@b.com', password: 'password' },
    ];
    const ids = await sql`INSERT INTO users ${sql(users)} RETURNING id`;
    userId = ids[0].id;
  });

  afterAll(async () => {
    await sql`DELETE FROM users`;
    sql.end();
  });

  beforeEach(async () => {
    const players = [
      {
        username: 'Old Name',
        total_recordings: 2,
        overall_experience: 150_000_000,
        attack_experience: 6_500_000,
        defence_experience: 6_500_000,
        strength_experience: 6_500_000,
        hitpoints_experience: 6_500_000,
        ranged_experience: 6_500_000,
        prayer_experience: 6_500_000,
        magic_experience: 6_500_000,
      },
      {
        username: 'New Name',
        total_recordings: 2,
        overall_experience: 200_000_000,
        attack_experience: 6_900_000,
        defence_experience: 6_900_000,
        strength_experience: 6_900_000,
        hitpoints_experience: 6_900_000,
        ranged_experience: 6_900_000,
        prayer_experience: 6_900_000,
        magic_experience: 6_900_000,
      },
      {
        username: 'SomeRandom',
        total_recordings: 4,
        overall_experience: 300_000_000,
        attack_experience: 7_000_000,
        defence_experience: 7_000_000,
        strength_experience: 7_000_000,
        hitpoints_experience: 7_000_000,
        ranged_experience: 7_000_000,
        prayer_experience: 7_000_000,
        magic_experience: 7_000_000,
      },
    ];

    const playerIds =
      await sql`INSERT INTO players ${sql(players)} RETURNING id`;

    oldPlayerId = playerIds[0].id;
    newPlayerId = playerIds[1].id;
    otherPlayerId = playerIds[2].id;

    const apiKeys = [
      {
        user_id: userId,
        player_id: oldPlayerId,
        key: 'old-key',
        active: true,
        last_used: new Date('2024-04-21'),
      },
      {
        user_id: userId,
        player_id: newPlayerId,
        key: 'new-key',
        active: true,
        last_used: new Date('2024-04-23'),
      },
      {
        user_id: userId,
        player_id: newPlayerId,
        key: 'new-key-2',
        active: true,
        last_used: null,
      },
    ];
    await sql`INSERT INTO api_keys ${sql(apiKeys)}`;

    const challenges = [
      {
        uuid: '11111111-1111-1111-1111-111111111111',
        start_time: new Date('2024-04-21'),
        type: ChallengeType.TOB,
        scale: 2,
      },
      {
        uuid: '22222222-2222-2222-2222-222222222222',
        start_time: new Date('2024-04-21'),
        type: ChallengeType.TOB,
        scale: 1,
      },
      {
        uuid: '33333333-3333-3333-3333-333333333333',
        start_time: new Date('2024-04-22'),
        type: ChallengeType.TOB,
        scale: 2,
      },
      {
        uuid: '44444444-4444-4444-4444-444444444444',
        start_time: new Date('2024-04-22'),
        type: ChallengeType.TOB,
        scale: 1,
      },
      {
        uuid: '55555555-5555-5555-5555-555555555555',
        start_time: new Date('2024-04-23'),
        type: ChallengeType.TOB,
        scale: 2,
      },
    ];
    const challengeIds =
      await sql`INSERT INTO challenges ${sql(challenges)} RETURNING id`.then(
        (res) => res.map((r) => r.id),
      );

    const challengePlayers = [
      {
        challenge_id: challengeIds[0],
        player_id: oldPlayerId,
        username: 'Old Name',
        orb: 0,
        primary_gear: 1,
      },
      {
        challenge_id: challengeIds[0],
        player_id: otherPlayerId,
        username: 'SomeRandom',
        orb: 1,
        primary_gear: 1,
      },
      {
        challenge_id: challengeIds[1],
        player_id: oldPlayerId,
        username: 'Old Name',
        orb: 0,
        primary_gear: 1,
      },
      {
        challenge_id: challengeIds[2],
        player_id: newPlayerId,
        username: 'New Name',
        orb: 0,
        primary_gear: 1,
      },
      {
        challenge_id: challengeIds[2],
        player_id: otherPlayerId,
        username: 'SomeRandom',
        orb: 1,
        primary_gear: 1,
      },
      {
        challenge_id: challengeIds[3],
        player_id: otherPlayerId,
        username: 'SomeRandom',
        orb: 0,
        primary_gear: 1,
      },
      {
        challenge_id: challengeIds[4],
        player_id: otherPlayerId,
        username: 'SomeRandom',
        orb: 0,
        primary_gear: 1,
      },
      {
        challenge_id: challengeIds[4],
        player_id: newPlayerId,
        username: 'New Name',
        orb: 1,
        primary_gear: 1,
      },
    ];
    await sql`INSERT INTO challenge_players ${sql(challengePlayers)}`;

    const splits = [
      {
        challenge_id: challengeIds[0],
        type: 1,
        scale: 2,
        ticks: 100,
        accurate: true,
      },
      {
        challenge_id: challengeIds[0],
        type: 2,
        scale: 2,
        ticks: 100,
        accurate: true,
      },
      {
        challenge_id: challengeIds[1],
        type: 3,
        scale: 2,
        ticks: 100,
        accurate: true,
      },
      {
        challenge_id: challengeIds[1],
        type: 5,
        scale: 2,
        ticks: 100,
        accurate: true,
      },
      {
        challenge_id: challengeIds[2],
        type: 2,
        scale: 2,
        ticks: 75,
        accurate: true,
      },
      {
        challenge_id: challengeIds[2],
        type: 3,
        scale: 2,
        ticks: 200,
        accurate: true,
      },
      {
        challenge_id: challengeIds[4],
        type: 1,
        scale: 2,
        ticks: 100,
        accurate: true,
      },
      {
        challenge_id: challengeIds[4],
        type: 4,
        scale: 2,
        ticks: 50,
        accurate: true,
      },
    ];
    const splitIds = await sql`
      INSERT INTO challenge_splits ${sql(splits)} RETURNING id
    `.then((res) => res.map((r) => r.id));

    challengeSplits = splits.map((split, index) => ({
      id: splitIds[index],
      type: split.type,
      scale: split.scale,
      ticks: split.ticks,
    }));

    const personalBests = [
      { player_id: oldPlayerId, challenge_split_id: splitIds[0] },
      { player_id: oldPlayerId, challenge_split_id: splitIds[1] },
      { player_id: oldPlayerId, challenge_split_id: splitIds[2] },
      { player_id: oldPlayerId, challenge_split_id: splitIds[3] },
      { player_id: newPlayerId, challenge_split_id: splitIds[4] },
      { player_id: newPlayerId, challenge_split_id: splitIds[5] },
      { player_id: newPlayerId, challenge_split_id: splitIds[6] },
      { player_id: newPlayerId, challenge_split_id: splitIds[7] },
    ];
    await sql`INSERT INTO personal_bests ${sql(personalBests)}`;

    // await PlayerStatsModel.insertMany([
    //   {
    //     playerId: oldPlayer._id,
    //     date: new Date('2024-04-20'),
    //     completions: 5,
    //     wipes: 1,
    //     deaths: 8,
    //     hammerBops: 9,
    //   },
    //   {
    //     playerId: oldPlayer._id,
    //     date: new Date('2024-04-21'),
    //     completions: 7,
    //     wipes: 2,
    //     deaths: 12,
    //     hammerBops: 10,
    //   },
    //   {
    //     playerId: newPlayer._id,
    //     date: new Date('2024-04-22'),
    //     completions: 2,
    //     wipes: 0,
    //     deaths: 1,
    //     hammerBops: 1,
    //   },
    //   {
    //     playerId: newPlayer._id,
    //     date: new Date('2024-04-23'),
    //     completions: 5,
    //     wipes: 2,
    //     deaths: 4,
    //     hammerBops: 1,
    //   },
    // ]);
  });

  afterEach(async () => {
    global.fetch = _fetch;
    await sql`DELETE FROM name_changes`;
    await sql`DELETE FROM personal_bests`;
    await sql`DELETE FROM challenge_splits`;
    await sql`DELETE FROM challenge_players`;
    await sql`DELETE FROM challenges`;
    await sql`DELETE FROM api_keys`;
    // sql`DELETE FROM player_stats`;
    await sql`DELETE FROM players`;
  });

  it('successfully migrates data from the new player to the old', async () => {
    // Mock the OSRS Hiscores API responses.
    // First response (old player): doesn't exist.
    // Second response (new player): exists.
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        status: 404,
      })
      .mockResolvedValueOnce({
        text: () => Promise.resolve(mockedHiscoresPayload(arbitraryExperience)),
      });

    const id = await createNameChangeRequest(
      'Old Name',
      oldPlayerId,
      'New Name',
    );
    await processNameChange(id);

    // Challenges in which the new player participated should be updated to
    // reference the old player instead.
    const expectedPartiesById: Record<string, number[]> = {
      '11111111-1111-1111-1111-111111111111': [oldPlayerId, otherPlayerId],
      '22222222-2222-2222-2222-222222222222': [oldPlayerId],
      '33333333-3333-3333-3333-333333333333': [oldPlayerId, otherPlayerId],
      '44444444-4444-4444-4444-444444444444': [otherPlayerId],
      '55555555-5555-5555-5555-555555555555': [otherPlayerId, oldPlayerId],
    };

    const updatedChallengePlayers = await sql`
      SELECT uuid, player_id, orb
      FROM challenge_players
      JOIN challenges ON challenge_players.challenge_id = challenges.id
      ORDER BY orb
    `;
    const updatedChallengeParties: Record<string, number[]> = {};
    updatedChallengePlayers.forEach((cp) => {
      if (!updatedChallengeParties[cp.uuid]) {
        updatedChallengeParties[cp.uuid] = [];
      }
      updatedChallengeParties[cp.uuid].push(cp.player_id);
    });

    expect(updatedChallengeParties).toEqual(expectedPartiesById);

    //   // Stats accumulated by the new player should be migrated to the old player.
    //   const expectedStats = [
    //     {
    //       playerId: oldPlayerId,
    //       date: new Date('2024-04-20'),
    //       completions: 5,
    //       wipes: 1,
    //       deaths: 8,
    //       hammerBops: 9,
    //     },
    //     {
    //       playerId: oldPlayerId,
    //       date: new Date('2024-04-21'),
    //       completions: 7,
    //       wipes: 2,
    //       deaths: 12,
    //       hammerBops: 10,
    //     },
    //     {
    //       playerId: oldPlayerId,
    //       date: new Date('2024-04-22'),
    //       completions: 9,
    //       wipes: 2,
    //       deaths: 13,
    //       hammerBops: 11,
    //     },
    //     {
    //       playerId: oldPlayerId,
    //       date: new Date('2024-04-23'),
    //       completions: 12,
    //       wipes: 4,
    //       deaths: 16,
    //       hammerBops: 11,
    //     },
    //   ];
    //   const updatedPlayerStats = await PlayerStatsModel.find({}, undefined, {
    //     sort: { date: 1 },
    //   })
    //     .lean()
    //     .exec();
    //   updatedPlayerStats.forEach((stats, index) => {
    //     expect(stats).toMatchObject(expectedStats[index]);
    //   });

    const expectedApiKeys = [
      { player_id: oldPlayerId, key: 'old-key' },
      { player_id: oldPlayerId, key: 'new-key' },
    ];
    const updatedApiKeys = await sql`SELECT * FROM api_keys`;
    expect(updatedApiKeys).toHaveLength(expectedApiKeys.length);
    updatedApiKeys.forEach((key, index) => {
      expect(key).toMatchObject(expectedApiKeys[index]);
    });

    const expectedPersonalBests = [
      { player_id: oldPlayerId, challenge_split_id: challengeSplits[0].id },
      { player_id: oldPlayerId, challenge_split_id: challengeSplits[2].id },
      { player_id: oldPlayerId, challenge_split_id: challengeSplits[3].id },
      { player_id: oldPlayerId, challenge_split_id: challengeSplits[4].id },
      { player_id: oldPlayerId, challenge_split_id: challengeSplits[7].id },
    ];
    const updatedPersonalBests = await sql`
      SELECT player_id, challenge_split_id FROM personal_bests
    `;
    updatedPersonalBests.sort(
      (a, b) => a.challenge_split_id - b.challenge_split_id,
    );
    expect(updatedPersonalBests).toHaveLength(expectedPersonalBests.length);
    updatedPersonalBests.forEach((pb, index) => {
      expect(pb).toMatchObject(expectedPersonalBests[index]);
    });

    const [updatedPlayer] =
      await sql`SELECT * FROM players WHERE id = ${oldPlayerId}`;
    expect(updatedPlayer).not.toBeUndefined();
    expect(updatedPlayer.username).toBe('New Name');
    expect(updatedPlayer.total_recordings).toBe(4);
    expect(BigInt(updatedPlayer.overall_experience)).toBe(BigInt(300_000_000));

    // All the new player's data following the change date should be deleted.
    const [newPlayerExists] = await sql`
      SELECT 1 FROM players WHERE id = ${newPlayerId}
    `;
    expect(newPlayerExists).toBeUndefined();
    //   const newPlayerStats = await PlayerStatsModel.countDocuments({
    //     playerId: newPlayerId,
    //   });
    //   expect(newPlayerStats).toBe(0);
    const [newPlayerChallengesCount] = await sql`
      SELECT COUNT(*) FROM challenge_players WHERE player_id = ${newPlayerId}
    `;
    expect(parseInt(newPlayerChallengesCount.count)).toBe(0);

    const updatedRequest = await loadNameChangeRequest(id);
    expect(updatedRequest!.status).toBe(NameChangeStatus.ACCEPTED);
    expect(updatedRequest!.processedAt).not.toBeNull();
    // expect(updatedRequest!.migratedDocuments).toBe(10);
    expect(updatedRequest!.migratedDocuments).toBe(8);
  });

  it('succeeds when a player has previously existed with the new name', async () => {
    // Add some data for the new player at an earlier date.
    await sql`
      UPDATE players
      SET total_recordings = total_recordings + 2
      WHERE id = ${newPlayerId}
    `;
    await sql`
      INSERT INTO api_keys (user_id, player_id, key, last_used)
      VALUES (${userId}, ${newPlayerId}, 'older-key', ${new Date('2024-03-21')})
    `;
    const newChallengeIds = await sql`
      INSERT INTO challenges (uuid, start_time, type, scale)
      VALUES
        ('66666666-6666-6666-6666-666666666666', ${new Date('2024-03-20')}, 1, 2),
        ('77777777-7777-7777-7777-777777777777', ${new Date('2024-03-20')}, 1, 2)
      RETURNING id
    `.then((res) => res.map((r) => r.id));
    await sql`
      INSERT INTO challenge_players (
        challenge_id,
        player_id,
        username,
        orb,
        primary_gear
      )
      VALUES
        (${newChallengeIds[0]}, ${newPlayerId}, 'New Name', 0, 1),
        (${newChallengeIds[0]}, ${otherPlayerId}, 'SomeRandom', 1, 1),
        (${newChallengeIds[1]}, ${newPlayerId}, 'New Name', 0, 1),
        (${newChallengeIds[1]}, ${otherPlayerId}, 'SomeRandom', 1, 1)
    `;
    const splitIds = await sql`
      INSERT INTO challenge_splits (challenge_id, type, scale, ticks, accurate)
      VALUES
        (${newChallengeIds[0]}, 6, 2, 33, true),
        (${newChallengeIds[1]}, 1, 2, 105, true)
      RETURNING id
    `.then((res) => res.map((r) => r.id));
    await sql`
      INSERT INTO personal_bests (player_id, challenge_split_id)
      VALUES (${newPlayerId}, ${splitIds[0]})
    `;
    //   await PlayerStatsModel.insertMany([
    //     {
    //       playerId: newPlayerId,
    //       date: new Date('2024-03-20'),
    //       completions: 1,
    //       wipes: 0,
    //       deaths: 0,
    //       hammerBops: 0,
    //     },
    //     {
    //       playerId: newPlayerId,
    //       date: new Date('2024-03-21'),
    //       completions: 2,
    //       wipes: 0,
    //       deaths: 1,
    //       hammerBops: 1,
    //     },
    //   ]);

    // Mock the OSRS Hiscores API responses.
    // First response (old player): doesn't exist.
    // Second response (new player): exists.
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        status: 404,
      })
      .mockResolvedValueOnce({
        text: () => Promise.resolve(mockedHiscoresPayload(arbitraryExperience)),
      });

    const id = await createNameChangeRequest(
      'Old Name',
      oldPlayerId,
      'New Name',
    );
    await processNameChange(id);

    // Challenges in which the new player participated should be updated to
    // reference the old player instead.
    //
    // Challenges '6' and '7' were recorded by an older user with the new
    // player's  name. These should not be migrated.
    const expectedPartiesById: Record<string, number[]> = {
      '11111111-1111-1111-1111-111111111111': [oldPlayerId, otherPlayerId],
      '22222222-2222-2222-2222-222222222222': [oldPlayerId],
      '33333333-3333-3333-3333-333333333333': [oldPlayerId, otherPlayerId],
      '44444444-4444-4444-4444-444444444444': [otherPlayerId],
      '55555555-5555-5555-5555-555555555555': [otherPlayerId, oldPlayerId],
      '66666666-6666-6666-6666-666666666666': [newPlayerId, otherPlayerId],
      '77777777-7777-7777-7777-777777777777': [newPlayerId, otherPlayerId],
    };

    const updatedChallengePlayers = await sql`
      SELECT uuid, player_id, orb
      FROM challenge_players
      JOIN challenges ON challenge_players.challenge_id = challenges.id
      ORDER BY orb
    `;
    const updatedChallengeParties: Record<string, number[]> = {};
    updatedChallengePlayers.forEach((cp) => {
      if (!updatedChallengeParties[cp.uuid]) {
        updatedChallengeParties[cp.uuid] = [];
      }
      updatedChallengeParties[cp.uuid].push(cp.player_id);
    });

    expect(updatedChallengeParties).toEqual(expectedPartiesById);

    // Stats accumulated by the new player should be migrated to the old player.
    //   const expectedStats = [
    //     {
    //       playerId: newPlayerId,
    //       date: new Date('2024-03-20'),
    //       completions: 1,
    //       wipes: 0,
    //       deaths: 0,
    //       hammerBops: 0,
    //     },
    //     {
    //       playerId: newPlayerId,
    //       date: new Date('2024-03-21'),
    //       completions: 2,
    //       wipes: 0,
    //       deaths: 1,
    //       hammerBops: 1,
    //     },
    //     {
    //       playerId: oldPlayerId,
    //       date: new Date('2024-04-20'),
    //       completions: 5,
    //       wipes: 1,
    //       deaths: 8,
    //       hammerBops: 9,
    //     },
    //     {
    //       playerId: oldPlayerId,
    //       date: new Date('2024-04-21'),
    //       completions: 7,
    //       wipes: 2,
    //       deaths: 12,
    //       hammerBops: 10,
    //     },
    //     {
    //       playerId: oldPlayerId,
    //       date: new Date('2024-04-22'),
    //       completions: 7,
    //       wipes: 2,
    //       deaths: 12,
    //       hammerBops: 10,
    //     },
    //     {
    //       playerId: oldPlayerId,
    //       date: new Date('2024-04-23'),
    //       completions: 10,
    //       wipes: 4,
    //       deaths: 15,
    //       hammerBops: 10,
    //     },
    //   ];
    //   const updatedPlayerStats = await PlayerStatsModel.find({}, undefined, {
    //     sort: { date: 1 },
    //   })
    //     .lean()
    //     .exec();
    //   updatedPlayerStats.forEach((stats, index) => {
    //     expect(stats).toMatchObject(expectedStats[index]);
    //   });

    const expectedApiKeys = [
      { player_id: oldPlayerId, key: 'new-key' },
      { player_id: oldPlayerId, key: 'old-key' },
      { player_id: newPlayerId, key: 'older-key' },
    ];
    const updatedApiKeys = await sql`SELECT * FROM api_keys ORDER BY key`;
    expect(updatedApiKeys).toHaveLength(expectedApiKeys.length);
    updatedApiKeys.forEach((key, index) => {
      expect(key).toMatchObject(expectedApiKeys[index]);
    });

    const expectedPersonalBests = [
      { player_id: oldPlayerId, challenge_split_id: challengeSplits[0].id },
      { player_id: oldPlayerId, challenge_split_id: challengeSplits[2].id },
      { player_id: oldPlayerId, challenge_split_id: challengeSplits[3].id },
      { player_id: oldPlayerId, challenge_split_id: challengeSplits[4].id },
      { player_id: oldPlayerId, challenge_split_id: challengeSplits[7].id },

      // This PB was never beaten by oldPlayer, so it should remain.
      { player_id: newPlayerId, challenge_split_id: splitIds[0] },

      // This PB was beaten by oldPlayer, but should be restored following
      // the migration.
      { player_id: newPlayerId, challenge_split_id: splitIds[1] },
    ];
    const updatedPersonalBests = await sql`
      SELECT player_id, challenge_split_id FROM personal_bests
    `;
    updatedPersonalBests.sort(
      (a, b) => a.challenge_split_id - b.challenge_split_id,
    );
    expect(updatedPersonalBests).toHaveLength(expectedPersonalBests.length);
    updatedPersonalBests.forEach((pb, index) => {
      expect(pb).toMatchObject(expectedPersonalBests[index]);
    });

    const [updatedPlayer] =
      await sql`SELECT * FROM players WHERE id = ${oldPlayerId}`;
    expect(updatedPlayer).not.toBeUndefined();
    expect(updatedPlayer.username).toBe('New Name');
    expect(updatedPlayer.total_recordings).toBe(4);
    expect(BigInt(updatedPlayer.overall_experience)).toBe(BigInt(300_000_000));

    // All the new player's data following the change date should be deleted,
    // but their earlier data should remain.
    const [newPlayer] =
      await sql`SELECT * FROM players WHERE id = ${newPlayerId}`;
    expect(newPlayer).not.toBeUndefined();
    expect(newPlayer.username).toBe('*New Name');
    expect(newPlayer.total_recordings).toBe(2);
    expect(BigInt(newPlayer.overall_experience)).toBe(BigInt(0));

    //   const newPlayerStats = await PlayerStatsModel.countDocuments({
    //     playerId: newPlayerId,
    //   });
    //   expect(newPlayerStats).toBe(2);
    //   const newPlayerChallenges = await RaidModel.countDocuments({
    //     partyIds: newPlayerId,
    //   });
    //   expect(newPlayerChallenges).toBe(2);

    const updatedRequest = await loadNameChangeRequest(id);
    expect(updatedRequest.status).toBe(NameChangeStatus.ACCEPTED);
    expect(updatedRequest.processedAt).not.toBeNull();
    // expect(updatedRequest.migratedDocuments).toBe(11);
    expect(updatedRequest.migratedDocuments).toBe(9);
  });

  it('updates name without any migration if the new player has no data', async () => {
    // Mock the OSRS Hiscores API responses.
    // First response (old player): doesn't exist.
    // Second response (new player): exists.
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        status: 404,
      })
      .mockResolvedValueOnce({
        text: () => Promise.resolve(mockedHiscoresPayload(arbitraryExperience)),
      });

    const id = await createNameChangeRequest('old name', oldPlayerId, 'Novel');
    await processNameChange(id);

    const [updatedPlayer] =
      await sql`SELECT * FROM players WHERE id = ${oldPlayerId}`;
    expect(updatedPlayer).not.toBeUndefined();
    expect(updatedPlayer.username).toBe('Novel');
    expect(updatedPlayer.total_recordings).toBe(2);
    expect(BigInt(updatedPlayer.overall_experience)).toBe(BigInt(300_000_000));

    const updatedRequest = await loadNameChangeRequest(id);
    expect(updatedRequest!.status).toBe(NameChangeStatus.ACCEPTED);
    expect(updatedRequest!.processedAt).not.toBeNull();
    expect(updatedRequest!.migratedDocuments).toBe(0);
  });

  it('fails with OLD_STILL_IN_USE if old player is on hiscores', async () => {
    // Mock the OSRS Hiscores API response.
    global.fetch = jest.fn().mockResolvedValue({
      text: () => Promise.resolve(mockedHiscoresPayload(arbitraryExperience)),
    });

    const id = await createNameChangeRequest(
      'old name',
      oldPlayerId,
      'new name',
    );
    await processNameChange(id);

    const updatedRequest = await loadNameChangeRequest(id);
    expect(updatedRequest!.status).toBe(NameChangeStatus.OLD_STILL_IN_USE);
    expect(updatedRequest!.processedAt).not.toBeNull();
    expect(updatedRequest!.migratedDocuments).toBe(0);
  });

  it('fails with NEW_DOES_NOT_EXIST if new player is not on hiscores', async () => {
    // Mock the OSRS Hiscores API response.
    global.fetch = jest.fn().mockResolvedValue({ status: 404 });

    const id = await createNameChangeRequest(
      'old name',
      oldPlayerId,
      'new name',
    );
    await processNameChange(id);

    const updatedRequest = await loadNameChangeRequest(id);
    expect(updatedRequest!.status).toBe(NameChangeStatus.NEW_DOES_NOT_EXIST);
    expect(updatedRequest!.processedAt).not.toBeNull();
    expect(updatedRequest!.migratedDocuments).toBe(0);
  });

  it("fails with DECREASED_EXPERIENCE if new player's experience is lower", async () => {
    // Mock the OSRS Hiscores API response.
    // First response (old player): doesn't exist.
    // Second response (new player): exists, but with lower experience.
    const decreasedExperience: PlayerExperience = {
      ...arbitraryExperience,
      [Skill.MAGIC]: 50_000,
    };
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        status: 404,
      })
      .mockResolvedValueOnce({
        text: () => Promise.resolve(mockedHiscoresPayload(decreasedExperience)),
      });

    const id = await createNameChangeRequest(
      'old name',
      oldPlayerId,
      'new name',
    );
    await processNameChange(id);

    const updatedRequest = await loadNameChangeRequest(id);
    expect(updatedRequest!.status).toBe(NameChangeStatus.DECREASED_EXPERIENCE);
    expect(updatedRequest!.processedAt).not.toBeNull();
    expect(updatedRequest!.migratedDocuments).toBe(0);
  });
});

async function createNameChangeRequest(
  oldName: string,
  playerId: number,
  newName: string,
): Promise<number> {
  const [{ id }] = await sql`
    INSERT INTO name_changes (
      player_id,
      old_name,
      new_name,
      status,
      submitted_at
    ) VALUES (
      ${playerId},
      ${oldName},
      ${newName},
      ${NameChangeStatus.PENDING},
      NOW()
    ) RETURNING id;
  `;

  return id;
}

type FullNameChange = NameChange & {
  id: number;
  playerId: number;
  submitterId: number | null;
  migratedDocuments: number;
};

async function loadNameChangeRequest(id: number): Promise<FullNameChange> {
  const [nameChange] = await sql`SELECT * FROM name_changes WHERE id = ${id}`;

  return {
    id: nameChange.id,
    oldName: nameChange.old_name,
    newName: nameChange.new_name,
    status: nameChange.status,
    submittedAt: nameChange.submitted_at,
    processedAt: nameChange.processed_at,
    playerId: nameChange.player_id,
    submitterId: nameChange.submitter_id,
    migratedDocuments: nameChange.migrated_documents,
  };
}

function mockedHiscoresPayload(experience: PlayerExperience): string {
  return Object.keys(experience)
    .sort((a, b) => parseInt(a) - parseInt(b))
    .map((skill) => {
      const exp = experience[skill as unknown as Skill];
      const level = 99;
      const rank = 1;
      return `${rank},${level},${exp}`;
    })
    .join('\n');
}
