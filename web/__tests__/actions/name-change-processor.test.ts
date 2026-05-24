import {
  ChallengeType,
  NameChange,
  NameChangeStatus,
  NameChangeUpdateType,
  PlayerExperience,
  Skill,
  normalizeRsn,
} from '@blert/common';

import { sql } from '@/actions/db';
import {
  NameChangeProcessor,
  processNameChange,
  recomputePbHistoryFrom,
  updateApiKeys,
  updatePersonalBestHistory,
  updatePlayerStats,
} from '@/actions/name-change-processor';
import redis from '@/actions/redis';

jest.mock('@/auth', () => {
  return {
    __esModule: true,
    auth: jest.fn(),
  };
});

jest.mock('@/actions/redis');

type MockRedisClient = {
  multi: jest.Mock;
  get: jest.Mock;
  publish: jest.Mock;
};

const mockedRedis = redis as jest.MockedFunction<typeof redis>;

function createMockRedisClient(): MockRedisClient {
  const mockMulti = {
    get: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue([null, null]),
  };
  return {
    multi: jest.fn().mockReturnValue(mockMulti),
    get: jest.fn().mockResolvedValue(null),
    publish: jest.fn().mockResolvedValue(1),
  };
}

type TestPlayer = {
  id: number;
  username: string;
  total_recordings: number;
  overall_experience: string | number;
};

type CountResult = { count: string };

describe('processNameChange', () => {
  type SeededSplit = {
    id: number;
    type: number;
    scale: number;
    ticks: number;
  };

  type ChallengeHistorySeed = {
    uuid: string;
    startTime: Date;
    finishTime: Date;
    type?: ChallengeType;
    scale: number;
    players: {
      playerId: number;
      username: string;
      orb: number;
      primaryGear?: number;
    }[];
    splits: {
      type: number;
      scale: number;
      ticks: number;
      accurate?: boolean;
    }[];
    personalBests?: {
      playerId: number;
      splitIndex: number;
    }[];
  };

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

  const _fetch = global.fetch;
  let userId: number;
  let oldPlayerId: number;
  let newPlayerId: number;
  let otherPlayerId: number;
  let challengeSplits: SeededSplit[];
  let mockRedisClient: MockRedisClient;

  beforeAll(async () => {
    const users = [
      { username: 'User 1', email: 'a@b.com', password: 'password' },
    ];
    const ids = await sql`INSERT INTO users ${sql(users)} RETURNING id`;
    userId = ids[0].id;
  });

  afterAll(async () => {
    await sql`DELETE FROM users WHERE username = 'User 1'`;
  });

  beforeEach(async () => {
    mockRedisClient = createMockRedisClient();
    mockedRedis.mockResolvedValue(
      mockRedisClient as unknown as Awaited<ReturnType<typeof redis>>,
    );

    const players = [
      {
        username: 'Old Name',
        normalized_username: normalizeRsn('Old Name'),
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
        normalized_username: normalizeRsn('New Name'),
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
        normalized_username: normalizeRsn('SomeRandom'),
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

    challengeSplits = [];
  });

  afterEach(async () => {
    global.fetch = _fetch;
    await sql`DELETE FROM name_changes`;
    await sql`DELETE FROM personal_best_history`;
    await sql`DELETE FROM challenge_splits`;
    await sql`DELETE FROM challenge_players`;
    await sql`DELETE FROM challenges`;
    await sql`DELETE FROM api_keys`;
    await sql`DELETE FROM player_stats`;
    await sql`DELETE FROM players`;
  });

  async function seedChallengeHistory(
    seeds: ChallengeHistorySeed[],
  ): Promise<{ challengeIds: number[]; splits: SeededSplit[] }> {
    const challengeIds: number[] = [];
    const seededSplits: SeededSplit[] = [];

    for (const seed of seeds) {
      const [{ id: challengeId }] = await sql<[{ id: number }]>`
        INSERT INTO challenges (uuid, start_time, finish_time, type, scale)
        VALUES (
          ${seed.uuid},
          ${seed.startTime},
          ${seed.finishTime},
          ${seed.type ?? ChallengeType.TOB},
          ${seed.scale}
        )
        RETURNING id
      `;
      challengeIds.push(challengeId);

      await sql`
        INSERT INTO challenge_players ${sql(
          seed.players.map((player) => ({
            challenge_id: challengeId,
            player_id: player.playerId,
            username: player.username,
            orb: player.orb,
            primary_gear: player.primaryGear ?? 1,
          })),
        )}
      `;

      const splitRows = seed.splits.map((split) => ({
        challenge_id: challengeId,
        type: split.type,
        scale: split.scale,
        ticks: split.ticks,
        accurate: split.accurate ?? true,
      }));
      const insertedSplits =
        splitRows.length > 0
          ? await sql<{ id: number }[]>`
              INSERT INTO challenge_splits ${sql(splitRows)} RETURNING id
            `
          : [];

      for (let i = 0; i < seed.splits.length; i++) {
        seededSplits.push({
          id: insertedSplits[i].id,
          type: seed.splits[i].type,
          scale: seed.splits[i].scale,
          ticks: seed.splits[i].ticks,
        });
      }

      if (seed.personalBests !== undefined && seed.personalBests.length > 0) {
        await sql`
          INSERT INTO personal_best_history ${sql(
            seed.personalBests.map((pb) => ({
              player_id: pb.playerId,
              challenge_split_id: insertedSplits[pb.splitIndex].id,
              created_at: seed.finishTime,
            })),
          )}
        `;
      }
    }

    return { challengeIds, splits: seededSplits };
  }

  async function seedDefaultHistory(): Promise<{
    challengeIds: number[];
    splits: SeededSplit[];
  }> {
    const seeded = await seedChallengeHistory([
      {
        uuid: '11111111-1111-1111-1111-111111111111',
        startTime: new Date('2024-04-21'),
        finishTime: new Date('2024-04-21'),
        scale: 2,
        players: [
          { playerId: oldPlayerId, username: 'Old Name', orb: 0 },
          { playerId: otherPlayerId, username: 'SomeRandom', orb: 1 },
        ],
        splits: [
          { type: 1, scale: 2, ticks: 100 },
          { type: 2, scale: 2, ticks: 100 },
        ],
        personalBests: [
          { playerId: oldPlayerId, splitIndex: 0 },
          { playerId: oldPlayerId, splitIndex: 1 },
        ],
      },
      {
        uuid: '22222222-2222-2222-2222-222222222222',
        startTime: new Date('2024-04-21'),
        finishTime: new Date('2024-04-21'),
        scale: 1,
        players: [{ playerId: oldPlayerId, username: 'Old Name', orb: 0 }],
        splits: [
          { type: 3, scale: 2, ticks: 100 },
          { type: 5, scale: 2, ticks: 100 },
        ],
        personalBests: [
          { playerId: oldPlayerId, splitIndex: 0 },
          { playerId: oldPlayerId, splitIndex: 1 },
        ],
      },
      {
        uuid: '33333333-3333-3333-3333-333333333333',
        startTime: new Date('2024-04-22'),
        finishTime: new Date('2024-04-22'),
        scale: 2,
        players: [
          { playerId: newPlayerId, username: 'New Name', orb: 0 },
          { playerId: otherPlayerId, username: 'SomeRandom', orb: 1 },
        ],
        splits: [
          { type: 2, scale: 2, ticks: 75 },
          { type: 3, scale: 2, ticks: 200 },
        ],
        personalBests: [
          { playerId: newPlayerId, splitIndex: 0 },
          { playerId: newPlayerId, splitIndex: 1 },
        ],
      },
      {
        uuid: '44444444-4444-4444-4444-444444444444',
        startTime: new Date('2024-04-22'),
        finishTime: new Date('2024-04-22'),
        scale: 1,
        players: [{ playerId: otherPlayerId, username: 'SomeRandom', orb: 0 }],
        splits: [],
      },
      {
        uuid: '55555555-5555-5555-5555-555555555555',
        startTime: new Date('2024-04-23'),
        finishTime: new Date('2024-04-23'),
        scale: 2,
        players: [
          { playerId: otherPlayerId, username: 'SomeRandom', orb: 0 },
          { playerId: newPlayerId, username: 'New Name', orb: 1 },
        ],
        splits: [
          { type: 1, scale: 2, ticks: 100 },
          { type: 4, scale: 2, ticks: 50 },
        ],
        personalBests: [
          { playerId: newPlayerId, splitIndex: 0 },
          { playerId: newPlayerId, splitIndex: 1 },
        ],
      },
    ]);

    await sql`
      INSERT INTO player_stats ${sql([
        {
          player_id: oldPlayerId,
          date: new Date('2024-04-20'),
          tob_completions: 5,
          tob_wipes: 1,
          deaths_total: 8,
          hammer_bops: 9,
        },
        {
          player_id: oldPlayerId,
          date: new Date('2024-04-21'),
          tob_completions: 7,
          tob_wipes: 2,
          deaths_total: 12,
          hammer_bops: 10,
        },
        {
          player_id: newPlayerId,
          date: new Date('2024-04-22'),
          tob_completions: 2,
          tob_wipes: 0,
          deaths_total: 1,
          hammer_bops: 1,
        },
        {
          player_id: newPlayerId,
          date: new Date('2024-04-23'),
          tob_completions: 5,
          tob_wipes: 2,
          deaths_total: 4,
          hammer_bops: 1,
        },
      ])}
    `;

    challengeSplits = seeded.splits;
    return seeded;
  }

  it('successfully migrates data from the new player to the old', async () => {
    await seedDefaultHistory();

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
    const result = await processNameChange(id);

    expect(result).toEqual({
      type: NameChangeUpdateType.MERGED,
      deletedPlayerId: newPlayerId,
      remainingPlayerId: oldPlayerId,
      oldName: 'Old Name',
      newName: 'New Name',
    });

    // Challenges in which the new player participated should be updated to
    // reference the old player instead.
    const expectedPartiesById: Record<string, number[]> = {
      '11111111-1111-1111-1111-111111111111': [oldPlayerId, otherPlayerId],
      '22222222-2222-2222-2222-222222222222': [oldPlayerId],
      '33333333-3333-3333-3333-333333333333': [oldPlayerId, otherPlayerId],
      '44444444-4444-4444-4444-444444444444': [otherPlayerId],
      '55555555-5555-5555-5555-555555555555': [otherPlayerId, oldPlayerId],
    };

    const updatedChallengePlayers = await sql<
      { uuid: string; player_id: number; orb: number }[]
    >`
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
    const expectedStats = [
      {
        player_id: oldPlayerId,
        date: new Date('2024-04-20'),
        tob_completions: 5,
        tob_wipes: 1,
        deaths_total: 8,
        hammer_bops: 9,
      },
      {
        player_id: oldPlayerId,
        date: new Date('2024-04-21'),
        tob_completions: 7,
        tob_wipes: 2,
        deaths_total: 12,
        hammer_bops: 10,
      },
      {
        player_id: oldPlayerId,
        date: new Date('2024-04-22'),
        tob_completions: 9,
        tob_wipes: 2,
        deaths_total: 13,
        hammer_bops: 11,
      },
      {
        player_id: oldPlayerId,
        date: new Date('2024-04-23'),
        tob_completions: 12,
        tob_wipes: 4,
        deaths_total: 16,
        hammer_bops: 11,
      },
    ];
    const updatedPlayerStats = await sql`
        SELECT
          player_id,
          date,
          tob_completions,
          tob_wipes,
          deaths_total,
          hammer_bops
        FROM player_stats
        ORDER BY date
      `;
    expect(updatedPlayerStats).toEqual(expectedStats);

    const expectedApiKeys = [
      { player_id: oldPlayerId, key: 'old-key' },
      { player_id: oldPlayerId, key: 'new-key' },
    ];
    const updatedApiKeys = await sql`SELECT * FROM api_keys`;
    expect(updatedApiKeys).toHaveLength(expectedApiKeys.length);
    updatedApiKeys.forEach((key, index) => {
      expect(key).toMatchObject(expectedApiKeys[index]);
    });

    const expectedPbHistory = [
      { player_id: oldPlayerId, challenge_split_id: challengeSplits[0].id },
      { player_id: oldPlayerId, challenge_split_id: challengeSplits[1].id },
      { player_id: oldPlayerId, challenge_split_id: challengeSplits[2].id },
      { player_id: oldPlayerId, challenge_split_id: challengeSplits[3].id },
      { player_id: oldPlayerId, challenge_split_id: challengeSplits[4].id },
      { player_id: oldPlayerId, challenge_split_id: challengeSplits[7].id },
    ];
    const updatedPbHistory = await sql`
      SELECT player_id, challenge_split_id FROM personal_best_history
    `;
    updatedPbHistory.sort(
      (a, b) => a.challenge_split_id - b.challenge_split_id,
    );
    expect(updatedPbHistory).toHaveLength(expectedPbHistory.length);
    updatedPbHistory.forEach((pb, index) => {
      expect(pb).toMatchObject(expectedPbHistory[index]);
    });

    const [updatedPlayer] = await sql<[TestPlayer?]>`
      SELECT * FROM players WHERE id = ${oldPlayerId}
    `;
    expect(updatedPlayer).not.toBeUndefined();
    expect(updatedPlayer!.username).toBe('New Name');
    expect(updatedPlayer!.total_recordings).toBe(4);
    expect(BigInt(updatedPlayer!.overall_experience)).toBe(BigInt(300_000_000));

    // All the new player's data following the change date should be deleted.
    const [newPlayerExists] = await sql`
      SELECT 1 FROM players WHERE id = ${newPlayerId}
    `;
    expect(newPlayerExists).toBeUndefined();
    const [newPlayerStats] = await sql<[CountResult]>`
      SELECT COUNT(*) FROM player_stats WHERE player_id = ${newPlayerId}
    `;
    expect(parseInt(newPlayerStats.count)).toBe(0);
    const [newPlayerChallenges] = await sql<[CountResult]>`
      SELECT COUNT(*) FROM challenge_players WHERE player_id = ${newPlayerId}
    `;
    expect(parseInt(newPlayerChallenges.count)).toBe(0);

    const updatedRequest = await loadNameChangeRequest(id);
    expect(updatedRequest.status).toBe(NameChangeStatus.ACCEPTED);
    expect(updatedRequest.processedAt).not.toBeNull();
    // 11 = 4 challenge_players + 2 api_keys + 2 player_stats + 3 PB history.
    expect(updatedRequest.migratedDocuments).toBe(11);
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
    const priorHistory = await seedChallengeHistory([
      {
        uuid: '66666666-6666-6666-6666-666666666666',
        startTime: new Date('2024-03-20'),
        finishTime: new Date('2024-03-20'),
        scale: 2,
        players: [
          { playerId: newPlayerId, username: 'New Name', orb: 0 },
          { playerId: otherPlayerId, username: 'SomeRandom', orb: 1 },
        ],
        splits: [{ type: 6, scale: 2, ticks: 33 }],
        personalBests: [{ playerId: newPlayerId, splitIndex: 0 }],
      },
      {
        uuid: '77777777-7777-7777-7777-777777777777',
        startTime: new Date('2024-03-20'),
        finishTime: new Date('2024-03-20'),
        scale: 2,
        players: [
          { playerId: newPlayerId, username: 'New Name', orb: 0 },
          { playerId: otherPlayerId, username: 'SomeRandom', orb: 1 },
        ],
        splits: [{ type: 1, scale: 2, ticks: 105 }],
        personalBests: [{ playerId: newPlayerId, splitIndex: 0 }],
      },
    ]);
    const extraSplitIds = priorHistory.splits.map((split) => split.id);

    await seedDefaultHistory();

    await sql`
      INSERT INTO player_stats (
        player_id,
        date,
        tob_completions,
        tob_wipes,
        deaths_total,
        hammer_bops
      ) VALUES
        (${newPlayerId}, ${new Date('2024-03-20')}, 1, 0, 0, 0),
        (${newPlayerId}, ${new Date('2024-03-21')}, 2, 0, 1, 1)
    `;

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
    const result = await processNameChange(id);

    expect(result).toEqual({
      type: NameChangeUpdateType.RENAMED,
      playerId: oldPlayerId,
      oldName: 'Old Name',
      newName: 'New Name',
    });

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

    const updatedChallengePlayers = await sql<
      { uuid: string; player_id: number; orb: number }[]
    >`
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
    const expectedStats = [
      {
        player_id: newPlayerId,
        date: new Date('2024-03-20'),
        tob_completions: 1,
        tob_wipes: 0,
        deaths_total: 0,
        hammer_bops: 0,
      },
      {
        player_id: newPlayerId,
        date: new Date('2024-03-21'),
        tob_completions: 2,
        tob_wipes: 0,
        deaths_total: 1,
        hammer_bops: 1,
      },
      {
        player_id: oldPlayerId,
        date: new Date('2024-04-20'),
        tob_completions: 5,
        tob_wipes: 1,
        deaths_total: 8,
        hammer_bops: 9,
      },
      {
        player_id: oldPlayerId,
        date: new Date('2024-04-21'),
        tob_completions: 7,
        tob_wipes: 2,
        deaths_total: 12,
        hammer_bops: 10,
      },
      {
        player_id: oldPlayerId,
        date: new Date('2024-04-22'),
        tob_completions: 7,
        tob_wipes: 2,
        deaths_total: 12,
        hammer_bops: 10,
      },
      {
        player_id: oldPlayerId,
        date: new Date('2024-04-23'),
        tob_completions: 10,
        tob_wipes: 4,
        deaths_total: 15,
        hammer_bops: 10,
      },
    ];
    const updatedPlayerStats = await sql`
        SELECT
          player_id,
          date,
          tob_completions,
          tob_wipes,
          deaths_total,
          hammer_bops
        FROM player_stats
        ORDER BY date
      `;
    expect(updatedPlayerStats).toEqual(expectedStats);

    const expectedApiKeys = [
      { player_id: oldPlayerId, key: 'new-key' },
      { player_id: newPlayerId, key: 'new-key-2' },
      { player_id: newPlayerId, key: 'older-key' },
      { player_id: oldPlayerId, key: 'old-key' },
    ];
    const updatedApiKeys = await sql`SELECT * FROM api_keys ORDER BY key`;
    expect(updatedApiKeys).toHaveLength(expectedApiKeys.length);
    updatedApiKeys.forEach((key, index) => {
      expect(key).toMatchObject(expectedApiKeys[index]);
    });

    const expectedOldPlayerPbHistory = [
      { player_id: oldPlayerId, challenge_split_id: challengeSplits[0].id },
      { player_id: oldPlayerId, challenge_split_id: challengeSplits[1].id },
      { player_id: oldPlayerId, challenge_split_id: challengeSplits[2].id },
      { player_id: oldPlayerId, challenge_split_id: challengeSplits[3].id },
      { player_id: oldPlayerId, challenge_split_id: challengeSplits[4].id },
      { player_id: oldPlayerId, challenge_split_id: challengeSplits[7].id },
    ];
    const oldPlayerPbHistory = await sql`
      SELECT player_id, challenge_split_id FROM personal_best_history WHERE player_id = ${oldPlayerId}
    `;
    oldPlayerPbHistory.sort(
      (a, b) => a.challenge_split_id - b.challenge_split_id,
    );
    expect(oldPlayerPbHistory).toHaveLength(expectedOldPlayerPbHistory.length);
    oldPlayerPbHistory.forEach((pb, index) => {
      expect(pb).toMatchObject(expectedOldPlayerPbHistory[index]);
    });

    // newPlayerId should retain its original PB history.
    const expectedNewPlayerPbHistory = [
      { player_id: newPlayerId, challenge_split_id: extraSplitIds[0] },
      { player_id: newPlayerId, challenge_split_id: extraSplitIds[1] },
    ];
    const newPlayerPbHistory = await sql`
      SELECT player_id, challenge_split_id FROM personal_best_history WHERE player_id = ${newPlayerId}
    `;
    expect(newPlayerPbHistory).toHaveLength(expectedNewPlayerPbHistory.length);
    newPlayerPbHistory.forEach((pb, index) => {
      expect(pb).toMatchObject(expectedNewPlayerPbHistory[index]);
    });

    const [updatedPlayer] = await sql<[TestPlayer?]>`
      SELECT * FROM players WHERE id = ${oldPlayerId}
    `;
    expect(updatedPlayer).not.toBeUndefined();
    expect(updatedPlayer!.username).toBe('New Name');
    expect(updatedPlayer!.total_recordings).toBe(4);
    expect(BigInt(updatedPlayer!.overall_experience)).toBe(BigInt(300_000_000));

    // All the new player's data following the change date should be deleted,
    // but their earlier data should remain.
    const [newPlayer] = await sql<[TestPlayer?]>`
      SELECT * FROM players WHERE id = ${newPlayerId}
    `;
    expect(newPlayer).not.toBeUndefined();
    expect(newPlayer!.username).toBe('*New Name');
    expect(newPlayer!.total_recordings).toBe(2);
    expect(BigInt(newPlayer!.overall_experience)).toBe(BigInt(0));

    const [newPlayerStats] = await sql<[CountResult]>`
      SELECT COUNT(*) FROM player_stats WHERE player_id = ${newPlayerId}
    `;
    expect(parseInt(newPlayerStats.count)).toBe(2);
    const [newPlayerChallenges] = await sql<[CountResult]>`
      SELECT COUNT(*) FROM challenge_players WHERE player_id = ${newPlayerId}
    `;
    expect(parseInt(newPlayerChallenges.count)).toBe(2);

    const updatedRequest = await loadNameChangeRequest(id);
    expect(updatedRequest.status).toBe(NameChangeStatus.ACCEPTED);
    expect(updatedRequest.processedAt).not.toBeNull();
    expect(updatedRequest.migratedDocuments).toBe(11);
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
    const result = await processNameChange(id);

    expect(result).toEqual({
      type: NameChangeUpdateType.RENAMED,
      playerId: oldPlayerId,
      oldName: 'old name',
      newName: 'Novel',
    });

    const [updatedPlayer] = await sql<[TestPlayer?]>`
      SELECT * FROM players WHERE id = ${oldPlayerId}
    `;
    expect(updatedPlayer).not.toBeUndefined();
    expect(updatedPlayer!.username).toBe('Novel');
    expect(updatedPlayer!.total_recordings).toBe(2);
    expect(BigInt(updatedPlayer!.overall_experience)).toBe(BigInt(300_000_000));

    const updatedRequest = await loadNameChangeRequest(id);
    expect(updatedRequest.status).toBe(NameChangeStatus.ACCEPTED);
    expect(updatedRequest.processedAt).not.toBeNull();
    expect(updatedRequest.migratedDocuments).toBe(0);
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
    const result = await processNameChange(id);

    expect(result).toBeNull();

    const updatedRequest = await loadNameChangeRequest(id);
    expect(updatedRequest.status).toBe(NameChangeStatus.OLD_STILL_IN_USE);
    expect(updatedRequest.processedAt).not.toBeNull();
    expect(updatedRequest.migratedDocuments).toBe(0);
  });

  it('fails with NEW_DOES_NOT_EXIST if new player is not on hiscores', async () => {
    // Mock the OSRS Hiscores API response.
    global.fetch = jest.fn().mockResolvedValue({ status: 404 });

    const id = await createNameChangeRequest(
      'old name',
      oldPlayerId,
      'new name',
    );
    const result = await processNameChange(id);

    expect(result).toBeNull();

    const updatedRequest = await loadNameChangeRequest(id);
    expect(updatedRequest.status).toBe(NameChangeStatus.NEW_DOES_NOT_EXIST);
    expect(updatedRequest.processedAt).not.toBeNull();
    expect(updatedRequest.migratedDocuments).toBe(0);
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
    const result = await processNameChange(id);

    expect(result).toBeNull();

    const updatedRequest = await loadNameChangeRequest(id);
    expect(updatedRequest.status).toBe(NameChangeStatus.DECREASED_EXPERIENCE);
    expect(updatedRequest.processedAt).not.toBeNull();
    expect(updatedRequest.migratedDocuments).toBe(0);
  });

  it('updates only the display name for separator-only changes', async () => {
    global.fetch = jest.fn();

    const id = await createNameChangeRequest(
      'Old Name',
      oldPlayerId,
      'Old_Name',
    );
    const result = await processNameChange(id);

    expect(result).toEqual({
      type: NameChangeUpdateType.RENAMED,
      playerId: oldPlayerId,
      oldName: 'Old Name',
      newName: 'Old_Name',
    });

    // Display name should be updated but normalized form is unchanged.
    const [updatedPlayer] = await sql<
      [{ username: string; normalized_username: string }?]
    >`
      SELECT username, normalized_username FROM players WHERE id = ${oldPlayerId}
    `;
    expect(updatedPlayer).not.toBeUndefined();
    expect(updatedPlayer!.username).toBe('Old_Name');
    expect(updatedPlayer!.normalized_username).toBe(normalizeRsn('Old Name'));

    // No data should have been migrated.
    const updatedRequest = await loadNameChangeRequest(id);
    expect(updatedRequest.status).toBe(NameChangeStatus.ACCEPTED);
    expect(updatedRequest.processedAt).not.toBeNull();
    expect(updatedRequest.migratedDocuments).toBe(0);

    // Hiscores should not have been called.
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('throws PlayerInActiveChallengeError if player is in active challenge', async () => {
    // Mock Redis to indicate the old player is in an active challenge.
    const mockMulti = {
      get: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(['some-challenge-uuid', null]),
    };
    mockRedisClient.multi.mockReturnValue(mockMulti);

    // Mock the OSRS Hiscores API responses.
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

    await expect(processNameChange(id)).rejects.toThrow(
      'Player in active challenge during name change processing',
    );

    // The name change should not have been processed.
    const updatedRequest = await loadNameChangeRequest(id);
    expect(updatedRequest.status).toBe(NameChangeStatus.PENDING);
    expect(updatedRequest.processedAt).toBeNull();
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

describe('NameChangeProcessor.processBatch', () => {
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

  const _fetch = global.fetch;
  let userId: number;
  let playerId: number;
  let mockRedisClient: MockRedisClient;
  let processor: NameChangeProcessor;

  beforeAll(async () => {
    const [{ id }] = await sql`
      INSERT INTO users (username, email, password)
      VALUES ('BatchTestUser', 'batch@test.com', 'password')
      RETURNING id
    `;
    userId = id;
  });

  afterAll(async () => {
    await sql`DELETE FROM users WHERE id = ${userId}`;
  });

  beforeEach(async () => {
    mockRedisClient = createMockRedisClient();
    mockedRedis.mockResolvedValue(
      mockRedisClient as unknown as Awaited<ReturnType<typeof redis>>,
    );

    const [{ id }] = await sql`
      INSERT INTO players (
        username,
        normalized_username,
        total_recordings,
        overall_experience,
        attack_experience,
        defence_experience,
        strength_experience,
        hitpoints_experience,
        ranged_experience,
        prayer_experience,
        magic_experience
      ) VALUES (
        'BatchPlayer',
        ${normalizeRsn('BatchPlayer')},
        0,
        100000000,
        5000000,
        5000000,
        5000000,
        5000000,
        5000000,
        5000000,
        5000000
      )
      RETURNING id
    `;
    playerId = id;

    processor = new NameChangeProcessor({ autoStart: false, batchSize: 5 });
  });

  afterEach(async () => {
    global.fetch = _fetch;
    processor?.stop();
    if (playerId) {
      await sql`DELETE FROM name_changes WHERE player_id = ${playerId}`;
      await sql`DELETE FROM players WHERE id = ${playerId}`;
    }
  });

  it('processes PENDING name changes and returns processed count', async () => {
    // Mock successful hiscores responses.
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({ status: 404 })
      .mockResolvedValueOnce({
        text: () => Promise.resolve(mockedHiscoresPayload(arbitraryExperience)),
      });

    await sql`
      INSERT INTO name_changes (player_id, old_name, new_name, status, submitted_at)
      VALUES (${playerId}, 'BatchPlayer', 'NewBatch', ${NameChangeStatus.PENDING}, NOW())
    `;

    const result = await processor.processBatch();

    expect(result.processed).toBe(1);
    expect(result.deferred).toBe(0);
    expect(result.promoted).toBe(0);

    const [updated] = await sql`
      SELECT status FROM name_changes WHERE player_id = ${playerId}
    `;
    expect(updated.status).toBe(NameChangeStatus.ACCEPTED);

    expect(mockRedisClient.publish).toHaveBeenCalledWith(
      'name-changes',
      expect.stringContaining(`"type":${NameChangeUpdateType.RENAMED}`),
    );
  });

  it('defers name changes when player is in active challenge', async () => {
    const mockMulti = {
      get: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(['active-challenge-uuid', null]),
    };
    mockRedisClient.multi.mockReturnValue(mockMulti);

    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({ status: 404 })
      .mockResolvedValueOnce({
        text: () => Promise.resolve(mockedHiscoresPayload(arbitraryExperience)),
      });

    await sql`
      INSERT INTO name_changes (player_id, old_name, new_name, status, submitted_at)
      VALUES (${playerId}, 'BatchPlayer', 'NewBatch', ${NameChangeStatus.PENDING}, NOW())
    `;

    const result = await processor.processBatch();

    expect(result.processed).toBe(0);
    expect(result.deferred).toBe(1);
    expect(result.promoted).toBe(0);

    const [updated] = await sql`
      SELECT status FROM name_changes WHERE player_id = ${playerId}
    `;
    expect(updated.status).toBe(NameChangeStatus.DEFERRED);
  });

  it('promotes DEFERRED entries when player is no longer in active challenge', async () => {
    await sql`
      INSERT INTO name_changes (player_id, old_name, new_name, status, submitted_at)
      VALUES (${playerId}, 'BatchPlayer', 'NewBatch', ${NameChangeStatus.DEFERRED}, NOW())
    `;

    // Mock Redis to indicate player is not in active challenge.
    const mockMulti = {
      get: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([null, null]),
    };
    mockRedisClient.multi.mockReturnValue(mockMulti);

    const result = await processor.processBatch();

    expect(result.processed).toBe(0);
    expect(result.deferred).toBe(0);
    expect(result.promoted).toBe(1);

    const [updated] = await sql`
      SELECT status FROM name_changes WHERE player_id = ${playerId}
    `;
    expect(updated.status).toBe(NameChangeStatus.PENDING);
  });

  it('does not promote DEFERRED entries when player is still in active challenge', async () => {
    await sql`
      INSERT INTO name_changes (player_id, old_name, new_name, status, submitted_at)
      VALUES (${playerId}, 'BatchPlayer', 'NewBatch', ${NameChangeStatus.DEFERRED}, NOW())
    `;

    // Mock Redis to indicate player is in an active challenge.
    const mockMulti = {
      get: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(['still-active-uuid', null]),
    };
    mockRedisClient.multi.mockReturnValue(mockMulti);

    const result = await processor.processBatch();

    expect(result.processed).toBe(0);
    expect(result.deferred).toBe(0);
    expect(result.promoted).toBe(0);

    const [updated] = await sql`
      SELECT status FROM name_changes WHERE player_id = ${playerId}
    `;
    expect(updated.status).toBe(NameChangeStatus.DEFERRED);
  });

  it('respects batchSize configuration', async () => {
    const smallBatchProcessor = new NameChangeProcessor({
      autoStart: false,
      batchSize: 2,
    });

    // Mock successful hiscores responses for multiple requests.
    global.fetch = jest.fn().mockImplementation(() =>
      Promise.resolve({
        status: 404,
      }),
    );

    // Insert 3 PENDING name changes.
    for (let i = 0; i < 3; i++) {
      const name = 'Bp' + i;
      const [{ id: pid }] = await sql<[{ id: number }]>`
        INSERT INTO players (username, normalized_username, total_recordings, overall_experience)
        VALUES (${name}, ${normalizeRsn(name)}, 0, 100000000)
        RETURNING id
      `;
      await sql`
        INSERT INTO name_changes (player_id, old_name, new_name, status, submitted_at)
        VALUES (${pid}, ${'Bp' + i}, ${'Nn' + i}, ${NameChangeStatus.PENDING}, NOW())
      `;
    }

    await smallBatchProcessor.processBatch();
    smallBatchProcessor.stop();

    // Should only process 2 (the batchSize), though they fail due to hiscores.
    // The third should not even be attempted.
    expect(global.fetch).toHaveBeenCalledTimes(4);

    await sql`DELETE FROM name_changes WHERE old_name LIKE 'Bp%'`;
    await sql`DELETE FROM players WHERE username LIKE 'Bp%' OR username LIKE 'Nn%'`;
  });
});

describe('updatePlayerStats', () => {
  let oldPlayerId: number;
  let newPlayerId: number;

  beforeEach(async () => {
    const [old] = await sql<[{ id: number }]>`
      INSERT INTO players (username, normalized_username, total_recordings)
      VALUES ('OldStats', ${normalizeRsn('OldStats')}, 0)
      RETURNING id
    `;
    oldPlayerId = old.id;

    const [neu] = await sql<[{ id: number }]>`
      INSERT INTO players (username, normalized_username, total_recordings)
      VALUES ('NewStats', ${normalizeRsn('NewStats')}, 0)
      RETURNING id
    `;
    newPlayerId = neu.id;
  });

  afterEach(async () => {
    await sql`DELETE FROM player_stats WHERE player_id = ANY(${[oldPlayerId, newPlayerId]})`;
    await sql`DELETE FROM players WHERE id = ANY(${[oldPlayerId, newPlayerId]})`;
  });

  type StatsSeed = {
    date: string;
    tobCompletions?: number;
    deathsTotal?: number;
  };

  async function seedStats(playerId: number, rows: StatsSeed[]) {
    for (const r of rows) {
      await sql`
        INSERT INTO player_stats (
          player_id, date, tob_completions, deaths_total
        ) VALUES (
          ${playerId}, ${new Date(r.date)}, ${r.tobCompletions ?? 0}, ${r.deathsTotal ?? 0}
        )
      `;
    }
  }

  type StatsRow = {
    date: Date;
    tob_completions: number;
    deaths_total: number;
  };

  async function loadStats(playerId: number) {
    return sql<StatsRow[]>`
      SELECT date, tob_completions, deaths_total
      FROM player_stats
      WHERE player_id = ${playerId}
      ORDER BY date ASC
    `;
  }

  it('moves all post-fromDate rows when toDate is null', async () => {
    await seedStats(oldPlayerId, [
      { date: '2026-01-01', tobCompletions: 5, deathsTotal: 2 },
    ]);
    await seedStats(newPlayerId, [
      { date: '2026-02-01', tobCompletions: 6, deathsTotal: 3 },
      { date: '2026-03-01', tobCompletions: 9, deathsTotal: 4 },
    ]);

    const moved = await updatePlayerStats(
      oldPlayerId,
      newPlayerId,
      new Date('2026-01-15'),
    );
    expect(moved).toBe(2);

    expect(await loadStats(newPlayerId)).toEqual([]);

    const oldRows = await loadStats(oldPlayerId);
    expect(oldRows).toHaveLength(3);
    // Original row, untouched.
    expect(oldRows[0].tob_completions).toBe(5);
    expect(oldRows[0].deaths_total).toBe(2);
    // Migrated rows are rebased onto old's last (5, 2) baseline.
    expect(oldRows[1].tob_completions).toBe(11);
    expect(oldRows[1].deaths_total).toBe(5);
    expect(oldRows[2].tob_completions).toBe(14);
    expect(oldRows[2].deaths_total).toBe(6);
  });

  it('migrates only in-window stats when toDate is set', async () => {
    await seedStats(newPlayerId, [
      { date: '2026-01-01', tobCompletions: 4 }, // pre-window
      { date: '2026-02-01', tobCompletions: 7 }, // in window
      { date: '2026-03-01', tobCompletions: 9 }, // in window
      { date: '2026-05-01', tobCompletions: 15 }, // post-window
    ]);

    const moved = await updatePlayerStats(
      oldPlayerId,
      newPlayerId,
      new Date('2026-01-15'),
      new Date('2026-04-01'),
      sql,
    );
    expect(moved).toBe(2);

    const newRows = await loadStats(newPlayerId);
    expect(newRows.map((r) => r.tob_completions)).toEqual([
      4, // pre-window untouched
      10, // post-window: original 15, delta 5
    ]);

    const oldRows = await loadStats(oldPlayerId);
    expect(oldRows.map((r) => r.tob_completions)).toEqual([3, 5]);
  });

  it('symmetrically adjusts post-window rows', async () => {
    await seedStats(newPlayerId, [
      // pre-window baseline
      { date: '2026-01-01', tobCompletions: 10, deathsTotal: 2 },
      // in-window (gain 5 tob, 1 death)
      { date: '2026-02-01', tobCompletions: 12, deathsTotal: 2 },
      { date: '2026-03-01', tobCompletions: 15, deathsTotal: 3 },
      // post-window (gain 4 tob, 1 death from new player's own recordings)
      { date: '2026-05-01', tobCompletions: 17, deathsTotal: 4 },
      { date: '2026-06-01', tobCompletions: 19, deathsTotal: 4 },
    ]);
    await seedStats(oldPlayerId, [
      // pre-window baseline
      { date: '2026-01-01', tobCompletions: 50, deathsTotal: 7 },
      // post-window: old player has its own activity recorded under its own
      // player_id; these counters never saw the in-window period.
      { date: '2026-05-01', tobCompletions: 53, deathsTotal: 8 },
      { date: '2026-06-01', tobCompletions: 55, deathsTotal: 9 },
    ]);

    await updatePlayerStats(
      oldPlayerId,
      newPlayerId,
      new Date('2026-01-15'),
      new Date('2026-04-01'),
      sql,
    );

    // In-window deltas: tob_completions 5, deaths_total 1. Subtract from new.
    const newRows = await loadStats(newPlayerId);
    expect(newRows).toEqual([
      expect.objectContaining({ tob_completions: 10, deaths_total: 2 }),
      expect.objectContaining({ tob_completions: 12, deaths_total: 3 }),
      expect.objectContaining({ tob_completions: 14, deaths_total: 3 }),
    ]);

    // Add to old.
    const oldRows = await loadStats(oldPlayerId);
    expect(oldRows).toEqual([
      expect.objectContaining({ tob_completions: 50, deaths_total: 7 }),
      expect.objectContaining({ tob_completions: 52, deaths_total: 7 }),
      expect.objectContaining({ tob_completions: 55, deaths_total: 8 }),
      expect.objectContaining({ tob_completions: 58, deaths_total: 9 }),
      expect.objectContaining({ tob_completions: 60, deaths_total: 10 }),
    ]);
  });

  it('is a no-op when there are no in-window rows', async () => {
    await seedStats(newPlayerId, [
      { date: '2026-01-01', tobCompletions: 4 },
      { date: '2026-05-01', tobCompletions: 10 },
    ]);

    const moved = await updatePlayerStats(
      oldPlayerId,
      newPlayerId,
      new Date('2026-02-01'),
      new Date('2026-04-01'),
      sql,
    );
    expect(moved).toBe(0);

    const newRows = await loadStats(newPlayerId);
    expect(newRows.map((r) => r.tob_completions)).toEqual([4, 10]);
    expect(await loadStats(oldPlayerId)).toEqual([]);
  });

  it('handles a missing newPlayer at fromDate snapshot', async () => {
    await seedStats(newPlayerId, [
      { date: '2026-02-01', tobCompletions: 8 },
      { date: '2026-05-01', tobCompletions: 12 },
    ]);

    await updatePlayerStats(
      oldPlayerId,
      newPlayerId,
      new Date('2026-01-15'),
      new Date('2026-04-01'),
      sql,
    );

    // In-window row's delta against zero baseline = 8.
    // Post-window 2026-05-01 originally 12, minus 8 = 4.
    const newRows = await loadStats(newPlayerId);
    expect(newRows.map((r) => r.tob_completions)).toEqual([4]);

    const oldRows = await loadStats(oldPlayerId);
    expect(oldRows.map((r) => r.tob_completions)).toEqual([8]);
  });
});

describe('updateApiKeys', () => {
  let targetPlayerId: number;
  let sourcePlayerId: number;
  let userId: number;

  beforeEach(async () => {
    const [user] = await sql<[{ id: number }]>`
      INSERT INTO users (username, email, password)
      VALUES ('key_tester', 'apikeytest@example.com', 'pw')
      RETURNING id
    `;
    userId = user.id;

    const [tgt] = await sql<[{ id: number }]>`
      INSERT INTO players (username, normalized_username, total_recordings)
      VALUES ('WWWWWWWWWWQQ', ${normalizeRsn('WWWWWWWWWWQQ')}, 0)
      RETURNING id
    `;
    targetPlayerId = tgt.id;

    const [src] = await sql<[{ id: number }]>`
      INSERT INTO players (username, normalized_username, total_recordings)
      VALUES ('1Ogp', ${normalizeRsn('1Ogp')}, 0)
      RETURNING id
    `;
    sourcePlayerId = src.id;
  });

  afterEach(async () => {
    await sql`DELETE FROM api_keys WHERE user_id = ${userId}`;
    await sql`DELETE FROM players WHERE id = ANY(${[targetPlayerId, sourcePlayerId]})`;
    await sql`DELETE FROM users WHERE id = ${userId}`;
  });

  type KeySeed = { key: string; lastUsed: string | null };

  async function seedKeys(playerId: number, keys: KeySeed[]) {
    for (const k of keys) {
      await sql`
        INSERT INTO api_keys (user_id, player_id, key, last_used)
        VALUES (
          ${userId},
          ${playerId},
          ${k.key},
          ${k.lastUsed === null ? null : new Date(k.lastUsed)}
        )
      `;
    }
  }

  async function loadKeys() {
    return sql<{ key: string; player_id: number; last_used: Date | null }[]>`
      SELECT key, player_id, last_used FROM api_keys
      WHERE user_id = ${userId}
      ORDER BY key
    `;
  }

  it('reassigns keys with last_used > fromDate when toDate is null', async () => {
    await seedKeys(sourcePlayerId, [
      { key: 'pre-fromdate', lastUsed: '2026-01-01' },
      { key: 'post-fromdate', lastUsed: '2026-03-01' },
      { key: 'unused', lastUsed: null },
    ]);

    const moved = await updateApiKeys(
      targetPlayerId,
      sourcePlayerId,
      new Date('2026-02-01'),
    );
    expect(moved).toBe(1);

    const rows = await loadKeys();
    expect(rows).toEqual([
      expect.objectContaining({
        key: 'post-fromdate',
        player_id: targetPlayerId,
      }),
      expect.objectContaining({
        key: 'pre-fromdate',
        player_id: sourcePlayerId,
      }),
      expect.objectContaining({ key: 'unused', player_id: sourcePlayerId }),
    ]);
  });

  it('reassigns only in-window keys when toDate is set', async () => {
    await seedKeys(sourcePlayerId, [
      { key: 'pre', lastUsed: '2026-01-01' },
      { key: 'in-window-1', lastUsed: '2026-02-15' },
      { key: 'in-window-2', lastUsed: '2026-03-15' },
      { key: 'post', lastUsed: '2026-05-15' },
      { key: 'unused', lastUsed: null },
    ]);

    const moved = await updateApiKeys(
      targetPlayerId,
      sourcePlayerId,
      new Date('2026-02-01'),
      new Date('2026-04-01'),
      sql,
    );
    expect(moved).toBe(2);

    const rows = await loadKeys();
    const byKey = (k: string) => rows.find((r) => r.key === k);
    expect(byKey('pre')?.player_id).toBe(sourcePlayerId);
    expect(byKey('in-window-1')?.player_id).toBe(targetPlayerId);
    expect(byKey('in-window-2')?.player_id).toBe(targetPlayerId);
    expect(byKey('post')?.player_id).toBe(sourcePlayerId);
    expect(byKey('unused')?.player_id).toBe(sourcePlayerId);
  });

  it('does not touch keys whose last_used is exactly fromDate or toDate boundaries', async () => {
    await seedKeys(sourcePlayerId, [
      { key: 'at-fromdate', lastUsed: '2026-02-01' },
      { key: 'at-todate', lastUsed: '2026-04-01' },
    ]);

    await updateApiKeys(
      targetPlayerId,
      sourcePlayerId,
      new Date('2026-02-01'),
      new Date('2026-04-01'),
      sql,
    );

    const rows = await loadKeys();
    expect(rows.find((r) => r.key === 'at-fromdate')?.player_id).toBe(
      sourcePlayerId,
    );
    expect(rows.find((r) => r.key === 'at-todate')?.player_id).toBe(
      targetPlayerId,
    );
  });

  it('returns 0 and changes nothing when no keys are in the window', async () => {
    await seedKeys(sourcePlayerId, [
      { key: 'pre', lastUsed: '2026-01-01' },
      { key: 'post', lastUsed: '2026-05-01' },
      { key: 'unused', lastUsed: null },
    ]);

    const moved = await updateApiKeys(
      targetPlayerId,
      sourcePlayerId,
      new Date('2026-02-01'),
      new Date('2026-04-01'),
      sql,
    );
    expect(moved).toBe(0);

    const rows = await loadKeys();
    expect(rows.every((r) => r.player_id === sourcePlayerId)).toBe(true);
  });
});

describe('recomputePbHistoryFrom', () => {
  let playerId: number;
  let challengeIdSeq = 0;

  beforeEach(async () => {
    const [p] = await sql<[{ id: number }]>`
      INSERT INTO players (username, normalized_username, total_recordings)
      VALUES ('PbRecompute', ${normalizeRsn('PbRecompute')}, 0)
      RETURNING id
    `;
    playerId = p.id;
  });

  afterEach(async () => {
    const challenges = await sql<{ id: number }[]>`
      SELECT challenge_id AS id FROM challenge_players WHERE player_id = ${playerId}
    `;
    const challengeIds = challenges.map((c) => c.id);
    if (challengeIds.length > 0) {
      await sql`DELETE FROM personal_best_history WHERE challenge_split_id IN (
        SELECT id FROM challenge_splits WHERE challenge_id = ANY(${challengeIds})
      )`;
      await sql`DELETE FROM challenge_splits WHERE challenge_id = ANY(${challengeIds})`;
      await sql`DELETE FROM challenge_players WHERE challenge_id = ANY(${challengeIds})`;
      await sql`DELETE FROM challenges WHERE id = ANY(${challengeIds})`;
    }
    await sql`DELETE FROM players WHERE id = ${playerId}`;
  });

  type SplitSeed = {
    finishedAt: string;
    type: number;
    scale: number;
    ticks: number;
    accurate?: boolean;
  };

  type SeededSplit = { challengeId: number; splitId: number };

  /**
   * Seeds one challenge per split.
   * inserted challenge and challenge_split row IDs in input order.
   */
  async function seedSplits(splits: SplitSeed[]): Promise<SeededSplit[]> {
    const out: SeededSplit[] = [];
    for (const s of splits) {
      challengeIdSeq += 1;
      const uuid = `00000000-0000-0000-0000-${String(challengeIdSeq).padStart(12, '0')}`;
      const [{ id: challengeId }] = await sql<[{ id: number }]>`
        INSERT INTO challenges (uuid, type, scale, start_time, finish_time)
        VALUES (${uuid}, ${s.type}, ${s.scale}, ${new Date(s.finishedAt)}, ${new Date(s.finishedAt)})
        RETURNING id
      `;
      await sql`
        INSERT INTO challenge_players (challenge_id, player_id, username, orb, primary_gear)
        VALUES (${challengeId}, ${playerId}, 'PbRecompute', 0, 1)
      `;
      const [{ id: splitId }] = await sql<[{ id: number }]>`
        INSERT INTO challenge_splits (challenge_id, type, scale, ticks, accurate)
        VALUES (${challengeId}, ${s.type}, ${s.scale}, ${s.ticks}, ${s.accurate ?? true})
        RETURNING id
      `;
      out.push({ challengeId, splitId });
    }
    return out;
  }

  async function loadPbHistory() {
    return sql<
      {
        challenge_split_id: number;
        type: number;
        scale: number;
        ticks: number;
        created_at: Date;
      }[]
    >`
      SELECT
        pbh.challenge_split_id,
        cs.type,
        cs.scale,
        cs.ticks,
        pbh.created_at
      FROM personal_best_history pbh
      JOIN challenge_splits cs ON pbh.challenge_split_id = cs.id
      WHERE pbh.player_id = ${playerId}
      ORDER BY pbh.created_at ASC
    `;
  }

  it('returns 0 and changes nothing when splitsToRecompute is empty', async () => {
    const [s0] = await seedSplits([
      { finishedAt: '2026-02-15', type: 1, scale: 5, ticks: 200 },
    ]);
    await sql`
      INSERT INTO personal_best_history (player_id, challenge_split_id, created_at)
      VALUES (${playerId}, ${s0.splitId}, ${new Date('2026-02-15')})
    `;

    const touched = await recomputePbHistoryFrom(playerId, [], s0.challengeId);
    expect(touched).toBe(0);

    expect(await loadPbHistory()).toHaveLength(1);
  });

  it('inserts a PB for the only post-cutoff split when no pre-cutoff best exists', async () => {
    const [s0] = await seedSplits([
      { finishedAt: '2026-03-01', type: 1, scale: 5, ticks: 200 },
    ]);

    const touched = await recomputePbHistoryFrom(
      playerId,
      [[1, 5]],
      s0.challengeId,
    );
    expect(touched).toBe(1);

    const rows = await loadPbHistory();
    expect(rows.map((r) => r.challenge_split_id)).toEqual([s0.splitId]);
  });

  it('only inserts PBs for splits that beat the running best', async () => {
    const seeds = await seedSplits([
      { finishedAt: '2026-03-01', type: 1, scale: 5, ticks: 200 },
      { finishedAt: '2026-04-01', type: 1, scale: 5, ticks: 220 }, // worse
      { finishedAt: '2026-05-01', type: 1, scale: 5, ticks: 180 }, // PB
      { finishedAt: '2026-06-01', type: 1, scale: 5, ticks: 190 }, // worse
      { finishedAt: '2026-07-01', type: 1, scale: 5, ticks: 170 }, // PB
    ]);

    await recomputePbHistoryFrom(playerId, [[1, 5]], seeds[0].challengeId);

    const rows = await loadPbHistory();
    expect(rows.map((r) => r.challenge_split_id)).toEqual([
      seeds[0].splitId,
      seeds[2].splitId,
      seeds[4].splitId,
    ]);
  });

  it("uses the player's pre-cutoff best as the starting threshold", async () => {
    const [_pre, worse, pb] = await seedSplits([
      { finishedAt: '2026-01-01', type: 1, scale: 5, ticks: 150 }, // pre-cutoff
      { finishedAt: '2026-03-01', type: 1, scale: 5, ticks: 160 }, // worse
      { finishedAt: '2026-04-01', type: 1, scale: 5, ticks: 140 }, // PB
    ]);

    await recomputePbHistoryFrom(playerId, [[1, 5]], worse.challengeId);

    const rows = await loadPbHistory();
    expect(rows.map((r) => r.challenge_split_id)).toEqual([pb.splitId]);
    expect(rows).not.toContainEqual(
      expect.objectContaining({ challenge_split_id: worse.splitId }),
    );
  });

  it('deletes existing post-cutoff PB rows that are no longer best', async () => {
    const [_pre, post] = await seedSplits([
      { finishedAt: '2026-01-01', type: 1, scale: 5, ticks: 100 }, // pre-cutoff
      { finishedAt: '2026-03-01', type: 1, scale: 5, ticks: 150 }, // now worse
    ]);
    await sql`
      INSERT INTO personal_best_history (player_id, challenge_split_id, created_at)
      VALUES (${playerId}, ${post.splitId}, ${new Date('2026-03-01')})
    `;

    const touched = await recomputePbHistoryFrom(
      playerId,
      [[1, 5]],
      post.challengeId,
    );
    expect(touched).toBe(1); // 1 deleted, 0 inserted

    expect(await loadPbHistory()).toEqual([]);
  });

  it('leaves pre-cutoff PB rows alone', async () => {
    const [pre, post] = await seedSplits([
      { finishedAt: '2026-01-01', type: 1, scale: 5, ticks: 100 },
      { finishedAt: '2026-03-01', type: 1, scale: 5, ticks: 90 },
    ]);
    await sql`
      INSERT INTO personal_best_history (player_id, challenge_split_id, created_at)
      VALUES (${playerId}, ${pre.splitId}, ${new Date('2026-01-01')})
    `;

    await recomputePbHistoryFrom(playerId, [[1, 5]], pre.challengeId);

    const rows = await loadPbHistory();
    expect(rows.map((r) => r.challenge_split_id)).toEqual([
      pre.splitId,
      post.splitId,
    ]);
  });

  it('handles multiple (type, scale) pairs independently', async () => {
    const seeds = await seedSplits([
      { finishedAt: '2026-03-01', type: 1, scale: 5, ticks: 200 }, // type 1: PB
      { finishedAt: '2026-03-02', type: 2, scale: 5, ticks: 300 }, // type 2: PB
      { finishedAt: '2026-04-01', type: 1, scale: 5, ticks: 250 }, // type 1: no
      { finishedAt: '2026-04-02', type: 2, scale: 5, ticks: 280 }, // type 2: PB
    ]);

    await recomputePbHistoryFrom(
      playerId,
      [
        [1, 5],
        [2, 5],
      ],
      seeds[0].challengeId,
    );

    const rows = await loadPbHistory();
    expect(rows.map((r) => r.challenge_split_id)).toEqual([
      seeds[0].splitId,
      seeds[1].splitId,
      seeds[3].splitId,
    ]);
  });

  it('ignores splits with accurate=false', async () => {
    const [inaccurate, accurate] = await seedSplits([
      {
        finishedAt: '2026-03-01',
        type: 1,
        scale: 5,
        ticks: 100,
        accurate: false,
      },
      {
        finishedAt: '2026-04-01',
        type: 1,
        scale: 5,
        ticks: 200,
        accurate: true,
      },
    ]);

    await recomputePbHistoryFrom(playerId, [[1, 5]], inaccurate.challengeId);

    const rows = await loadPbHistory();
    expect(rows.map((r) => r.challenge_split_id)).toEqual([accurate.splitId]);
    expect(rows).not.toContainEqual(
      expect.objectContaining({ challenge_split_id: inaccurate.splitId }),
    );
  });

  it('only touches the requested (type, scale) pairs', async () => {
    const [type1, type2] = await seedSplits([
      { finishedAt: '2026-03-01', type: 1, scale: 5, ticks: 200 },
      { finishedAt: '2026-03-02', type: 2, scale: 5, ticks: 300 },
    ]);
    // Pre-existing PB on type=2 should remain as we only ask recompute to
    // handle (type=1, scale=5).
    await sql`
      INSERT INTO personal_best_history (player_id, challenge_split_id, created_at)
      VALUES (${playerId}, ${type2.splitId}, ${new Date('2026-03-02')})
    `;

    await recomputePbHistoryFrom(playerId, [[1, 5]], type1.challengeId);

    const rows = await loadPbHistory();
    expect(rows.map((r) => r.challenge_split_id).sort()).toEqual(
      [type1.splitId, type2.splitId].sort(),
    );
  });
});

describe('updatePersonalBestHistory', () => {
  let oldPlayerId: number;
  let newPlayerId: number;
  let challengeIdSeq = 0;

  beforeEach(async () => {
    const [old] = await sql<[{ id: number }]>`
      INSERT INTO players (username, normalized_username, total_recordings)
      VALUES ('PbOld', ${normalizeRsn('PbOld')}, 0)
      RETURNING id
    `;
    oldPlayerId = old.id;
    const [neu] = await sql<[{ id: number }]>`
      INSERT INTO players (username, normalized_username, total_recordings)
      VALUES ('PbNew', ${normalizeRsn('PbNew')}, 0)
      RETURNING id
    `;
    newPlayerId = neu.id;
  });

  afterEach(async () => {
    const challenges = await sql<{ id: number }[]>`
      SELECT DISTINCT challenge_id AS id FROM challenge_players
      WHERE player_id = ANY(${[oldPlayerId, newPlayerId]})
    `;
    const challengeIds = challenges.map((c) => c.id);
    if (challengeIds.length > 0) {
      await sql`DELETE FROM personal_best_history WHERE challenge_split_id IN (
        SELECT id FROM challenge_splits WHERE challenge_id = ANY(${challengeIds})
      )`;
      await sql`DELETE FROM challenge_splits WHERE challenge_id = ANY(${challengeIds})`;
      await sql`DELETE FROM challenge_players WHERE challenge_id = ANY(${challengeIds})`;
      await sql`DELETE FROM challenges WHERE id = ANY(${challengeIds})`;
    }
    await sql`DELETE FROM players WHERE id = ANY(${[oldPlayerId, newPlayerId]})`;
  });

  /**
   * Inserts one challenge + challenge_player + challenge_split row and
   * returns the IDs. `attachedTo` controls which player owns the cp row.
   */
  async function seedSplit(args: {
    finishedAt: string;
    type: number;
    scale: number;
    ticks: number;
    attachedTo: number;
    accurate?: boolean;
  }): Promise<{ challengeId: number; splitId: number }> {
    challengeIdSeq += 1;
    const uuid = `00000000-0000-0000-0000-${String(challengeIdSeq).padStart(12, '0')}`;
    const [{ id: challengeId }] = await sql<[{ id: number }]>`
      INSERT INTO challenges (uuid, type, scale, start_time, finish_time)
      VALUES (${uuid}, ${args.type}, ${args.scale}, ${new Date(args.finishedAt)}, ${new Date(args.finishedAt)})
      RETURNING id
    `;
    await sql`
      INSERT INTO challenge_players (challenge_id, player_id, username, orb, primary_gear)
      VALUES (${challengeId}, ${args.attachedTo}, 'pb', 0, 1)
    `;
    const [{ id: splitId }] = await sql<[{ id: number }]>`
      INSERT INTO challenge_splits (challenge_id, type, scale, ticks, accurate)
      VALUES (${challengeId}, ${args.type}, ${args.scale}, ${args.ticks}, ${args.accurate ?? true})
      RETURNING id
    `;
    return { challengeId, splitId };
  }

  async function insertPb(
    playerId: number,
    splitId: number,
    finishedAt: string,
  ) {
    await sql`
      INSERT INTO personal_best_history (player_id, challenge_split_id, created_at)
      VALUES (${playerId}, ${splitId}, ${new Date(finishedAt)})
    `;
  }

  async function pbHistoryFor(playerId: number) {
    return sql<{ challenge_split_id: number; ticks: number }[]>`
      SELECT pbh.challenge_split_id, cs.ticks
      FROM personal_best_history pbh
      JOIN challenge_splits cs ON pbh.challenge_split_id = cs.id
      WHERE pbh.player_id = ${playerId}
      ORDER BY pbh.created_at ASC
    `;
  }

  it('returns 0 when challengeIds is empty', async () => {
    const touched = await updatePersonalBestHistory(
      oldPlayerId,
      newPlayerId,
      [],
    );
    expect(touched).toBe(0);
  });

  it('returns 0 when none of the migrated challenges have accurate splits', async () => {
    const c = await seedSplit({
      finishedAt: '2026-02-15',
      type: 1,
      scale: 5,
      ticks: 100,
      attachedTo: oldPlayerId,
      accurate: false,
    });
    const touched = await updatePersonalBestHistory(oldPlayerId, newPlayerId, [
      c.challengeId,
    ]);
    expect(touched).toBe(0);
    expect(await pbHistoryFor(oldPlayerId)).toEqual([]);
  });

  it("inserts old player PBs for migrated splits that beat the old player's prior best", async () => {
    // Old player's existing PB.
    const oldPb = await seedSplit({
      finishedAt: '2026-01-01',
      type: 1,
      scale: 5,
      ticks: 200,
      attachedTo: oldPlayerId,
    });
    await insertPb(oldPlayerId, oldPb.splitId, '2026-01-01');

    // Two migrated splits: 220 (worse, no PB) and 180 (better, PB).
    const worse = await seedSplit({
      finishedAt: '2026-02-15',
      type: 1,
      scale: 5,
      ticks: 220,
      attachedTo: oldPlayerId,
    });
    const better = await seedSplit({
      finishedAt: '2026-02-16',
      type: 1,
      scale: 5,
      ticks: 180,
      attachedTo: oldPlayerId,
    });

    await updatePersonalBestHistory(oldPlayerId, newPlayerId, [
      worse.challengeId,
      better.challengeId,
    ]);

    const oldRows = await pbHistoryFor(oldPlayerId);
    expect(oldRows.map((r) => r.challenge_split_id)).toEqual([
      oldPb.splitId,
      better.splitId,
    ]);
  });

  it('walks migrated splits chronologically, only inserting progressive PBs', async () => {
    const splits = await Promise.all([
      seedSplit({
        finishedAt: '2026-02-01',
        type: 1,
        scale: 5,
        ticks: 200,
        attachedTo: oldPlayerId,
      }), // PB
      seedSplit({
        finishedAt: '2026-02-02',
        type: 1,
        scale: 5,
        ticks: 220,
        attachedTo: oldPlayerId,
      }), // not a PB
      seedSplit({
        finishedAt: '2026-02-03',
        type: 1,
        scale: 5,
        ticks: 180,
        attachedTo: oldPlayerId,
      }), // PB
      seedSplit({
        finishedAt: '2026-02-04',
        type: 1,
        scale: 5,
        ticks: 190,
        attachedTo: oldPlayerId,
      }), // not a PB
      seedSplit({
        finishedAt: '2026-02-05',
        type: 1,
        scale: 5,
        ticks: 170,
        attachedTo: oldPlayerId,
      }), // PB
    ]);

    await updatePersonalBestHistory(
      oldPlayerId,
      newPlayerId,
      splits.map((s) => s.challengeId),
    );

    const oldRows = await pbHistoryFor(oldPlayerId);
    expect(oldRows.map((r) => r.challenge_split_id)).toEqual([
      splits[0].splitId,
      splits[2].splitId,
      splits[4].splitId,
    ]);
  });

  it("deletes the new player's PB rows for the migrated challenges' splits", async () => {
    // New player has a PB row for a split that's about to be migrated.
    const migrated = await seedSplit({
      finishedAt: '2026-02-15',
      type: 1,
      scale: 5,
      ticks: 100,
      attachedTo: oldPlayerId, // already migrated to old
    });
    await insertPb(newPlayerId, migrated.splitId, '2026-02-15');
    // New player also has an unrelated PB row that must NOT be touched.
    const untouched = await seedSplit({
      finishedAt: '2026-03-01',
      type: 2,
      scale: 5,
      ticks: 250,
      attachedTo: newPlayerId,
    });
    await insertPb(newPlayerId, untouched.splitId, '2026-03-01');

    await updatePersonalBestHistory(oldPlayerId, newPlayerId, [
      migrated.challengeId,
    ]);

    const newRows = await pbHistoryFor(newPlayerId);
    expect(newRows.map((r) => r.challenge_split_id)).toEqual([
      untouched.splitId,
    ]);
  });

  it('handles multiple (type, scale) pairs independently', async () => {
    const splits = await Promise.all([
      seedSplit({
        finishedAt: '2026-02-01',
        type: 1,
        scale: 5,
        ticks: 100,
        attachedTo: oldPlayerId,
      }),
      seedSplit({
        finishedAt: '2026-02-02',
        type: 2,
        scale: 5,
        ticks: 200,
        attachedTo: oldPlayerId,
      }),
      seedSplit({
        finishedAt: '2026-02-03',
        type: 1,
        scale: 5,
        ticks: 150,
        attachedTo: oldPlayerId,
      }), // worse for type=1
      seedSplit({
        finishedAt: '2026-02-04',
        type: 2,
        scale: 5,
        ticks: 180,
        attachedTo: oldPlayerId,
      }), // PB for type=2
    ]);

    await updatePersonalBestHistory(
      oldPlayerId,
      newPlayerId,
      splits.map((s) => s.challengeId),
    );

    const oldRows = await pbHistoryFor(oldPlayerId);
    expect(oldRows.map((r) => r.challenge_split_id)).toEqual([
      splits[0].splitId,
      splits[1].splitId,
      splits[3].splitId,
    ]);
  });

  describe('recomputePostCutoff', () => {
    it('drops a stale post-cutoff PB on old player when in-window absorbs a better one', async () => {
      const inWindow = await seedSplit({
        finishedAt: '2026-02-15',
        type: 1,
        scale: 5,
        ticks: 150,
        attachedTo: oldPlayerId,
      });
      const post = await seedSplit({
        finishedAt: '2026-05-01',
        type: 1,
        scale: 5,
        ticks: 200,
        attachedTo: oldPlayerId,
      });
      await insertPb(oldPlayerId, post.splitId, '2026-05-01');

      await updatePersonalBestHistory(
        oldPlayerId,
        newPlayerId,
        [inWindow.challengeId],
        sql,
      );

      const oldRows = await pbHistoryFor(oldPlayerId);
      expect(oldRows.map((r) => r.challenge_split_id)).toEqual([
        inWindow.splitId,
      ]);
    });

    it('inserts an in-window PB even when the target has a faster post-cutoff PB', async () => {
      const preWindow = await seedSplit({
        finishedAt: '2026-01-01',
        type: 1,
        scale: 5,
        ticks: 200,
        attachedTo: oldPlayerId,
      });
      await insertPb(oldPlayerId, preWindow.splitId, '2026-01-01');

      const inWindow = await seedSplit({
        finishedAt: '2026-02-15',
        type: 1,
        scale: 5,
        ticks: 180,
        attachedTo: oldPlayerId,
      });

      const postCutoff = await seedSplit({
        finishedAt: '2026-05-01',
        type: 1,
        scale: 5,
        ticks: 150,
        attachedTo: oldPlayerId,
      });
      await insertPb(oldPlayerId, postCutoff.splitId, '2026-05-01');

      await updatePersonalBestHistory(
        oldPlayerId,
        newPlayerId,
        [inWindow.challengeId],
        sql,
      );

      const oldRows = await pbHistoryFor(oldPlayerId);
      expect(oldRows.map((r) => r.challenge_split_id)).toEqual([
        preWindow.splitId,
        inWindow.splitId,
        postCutoff.splitId,
      ]);
    });

    it("adds a new eligible PB on new player's post-cutoff history", async () => {
      // In-window split, currently the new player's PB.
      const inWindow = await seedSplit({
        finishedAt: '2026-02-15',
        type: 1,
        scale: 5,
        ticks: 100,
        attachedTo: oldPlayerId, // already moved
      });
      await insertPb(newPlayerId, inWindow.splitId, '2026-02-15');
      // Post-cutoff split on new player that wasn't a PB at the time.
      const post = await seedSplit({
        finishedAt: '2026-05-01',
        type: 1,
        scale: 5,
        ticks: 120,
        attachedTo: newPlayerId,
      });

      await updatePersonalBestHistory(
        oldPlayerId,
        newPlayerId,
        [inWindow.challengeId],
        sql,
      );

      const newRows = await pbHistoryFor(newPlayerId);
      expect(newRows.map((r) => r.challenge_split_id)).toEqual([post.splitId]);
    });
  });
});

// Close database connection after all tests.
afterAll(async () => {
  await sql.end();
});
