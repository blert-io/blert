import {
  ChallengeType,
  NameChange,
  NameChangeKind,
  NameChangeStatus,
  NameChangeUpdateType,
  PlayerExperience,
  Skill,
  normalizeRsn,
} from '@blert/common';

import { sql } from '@/actions/db';
import {
  ChainTransition,
  NameChangeProcessor,
  apply,
  belongsToChainTarget,
  decide,
  deleteEmptiedSources,
  deriveNameWindows,
  dryRunHistoricNameChange,
  formatPlan,
  nameInWindowsAt,
  processNameChange,
  recomputePbHistoryFrom,
  updateApiKeys,
  updatePersonalBestHistory,
  updatePlayerStats,
  validateChain,
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
      submitted_at,
      effective_from
    ) VALUES (
      ${playerId},
      ${oldName},
      ${newName},
      ${NameChangeStatus.PENDING},
      NOW(),
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
    kind: nameChange.kind,
    effectiveFrom: nameChange.effective_from,
    effectiveTo: nameChange.effective_to,
    sequenceId: nameChange.sequence_id,
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
      INSERT INTO name_changes (player_id, old_name, new_name, status, submitted_at, effective_from)
      VALUES (${playerId}, 'BatchPlayer', 'NewBatch', ${NameChangeStatus.PENDING}, NOW(), NOW())
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
      INSERT INTO name_changes (player_id, old_name, new_name, status, submitted_at, effective_from)
      VALUES (${playerId}, 'BatchPlayer', 'NewBatch', ${NameChangeStatus.PENDING}, NOW(), NOW())
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
      INSERT INTO name_changes (player_id, old_name, new_name, status, submitted_at, effective_from)
      VALUES (${playerId}, 'BatchPlayer', 'NewBatch', ${NameChangeStatus.DEFERRED}, NOW(), NOW())
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
      INSERT INTO name_changes (player_id, old_name, new_name, status, submitted_at, effective_from)
      VALUES (${playerId}, 'BatchPlayer', 'NewBatch', ${NameChangeStatus.DEFERRED}, NOW(), NOW())
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
        INSERT INTO name_changes (player_id, old_name, new_name, status, submitted_at, effective_from)
        VALUES (${pid}, ${'Bp' + i}, ${'Nn' + i}, ${NameChangeStatus.PENDING}, NOW(), NOW())
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

  it('moves all rows up to toDate when fromDate is null', async () => {
    await seedStats(newPlayerId, [
      { date: '2026-01-01', tobCompletions: 3, deathsTotal: 1 },
      { date: '2026-02-01', tobCompletions: 7, deathsTotal: 2 },
      { date: '2026-05-01', tobCompletions: 15, deathsTotal: 5 }, // post-window
    ]);

    const moved = await updatePlayerStats(
      oldPlayerId,
      newPlayerId,
      null,
      new Date('2026-04-01'),
      sql,
    );
    expect(moved).toBe(2);

    // With no fromDate there is no prior baseline, so the in-window rows move
    // unchanged onto the (empty) target.
    const oldRows = await loadStats(oldPlayerId);
    expect(oldRows.map((r) => r.tob_completions)).toEqual([3, 7]);
    expect(oldRows.map((r) => r.deaths_total)).toEqual([1, 2]);

    // The post-window row stays on the source, decremented by the window delta
    // (7 tob, 2 deaths).
    const newRows = await loadStats(newPlayerId);
    expect(newRows.map((r) => r.tob_completions)).toEqual([8]);
    expect(newRows.map((r) => r.deaths_total)).toEqual([3]);
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
      { key: 'pre-from-date', lastUsed: '2026-01-01' },
      { key: 'post-from-date', lastUsed: '2026-03-01' },
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
        key: 'post-from-date',
        player_id: targetPlayerId,
      }),
      expect.objectContaining({
        key: 'pre-from-date',
        player_id: sourcePlayerId,
      }),
      expect.objectContaining({ key: 'unused', player_id: sourcePlayerId }),
    ]);
  });

  it('reassigns all keys up to toDate when fromDate is null', async () => {
    await seedKeys(sourcePlayerId, [
      { key: 'early', lastUsed: '2026-01-01' },
      { key: 'in-window', lastUsed: '2026-02-15' },
      { key: 'post', lastUsed: '2026-05-15' },
      { key: 'unused', lastUsed: null },
    ]);

    const moved = await updateApiKeys(
      targetPlayerId,
      sourcePlayerId,
      null,
      new Date('2026-04-01'),
      sql,
    );
    expect(moved).toBe(2);

    const rows = await loadKeys();
    const byKey = (k: string) => rows.find((r) => r.key === k);
    expect(byKey('early')?.player_id).toBe(targetPlayerId);
    expect(byKey('in-window')?.player_id).toBe(targetPlayerId);
    expect(byKey('post')?.player_id).toBe(sourcePlayerId);
    // A null last_used never satisfies the upper bound.
    expect(byKey('unused')?.player_id).toBe(sourcePlayerId);
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
      { key: 'at-from-date', lastUsed: '2026-02-01' },
      { key: 'at-to-date', lastUsed: '2026-04-01' },
    ]);

    await updateApiKeys(
      targetPlayerId,
      sourcePlayerId,
      new Date('2026-02-01'),
      new Date('2026-04-01'),
      sql,
    );

    const rows = await loadKeys();
    expect(rows.find((r) => r.key === 'at-from-date')?.player_id).toBe(
      sourcePlayerId,
    );
    expect(rows.find((r) => r.key === 'at-to-date')?.player_id).toBe(
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

describe('historic name changes', () => {
  let createdPlayerIds: number[] = [];
  let userId: number;
  let keyCounter = 0;

  beforeAll(async () => {
    const [{ id }] = await sql<{ id: number }[]>`
      INSERT INTO users (username, email, password)
      VALUES ('Historic User', 'historic@b.com', 'password')
      RETURNING id
    `;
    userId = id;
  });

  afterAll(async () => {
    await sql`DELETE FROM users WHERE id = ${userId}`;
  });

  async function makePlayer(username: string): Promise<number> {
    const [{ id }] = await sql<{ id: number }[]>`
      INSERT INTO players (username, normalized_username)
      VALUES (${username}, ${normalizeRsn(username)})
      RETURNING id
    `;
    createdPlayerIds.push(id);
    return id;
  }

  async function makeChallenge(
    playerId: number,
    username: string,
    startTime: string,
  ): Promise<number> {
    const [{ id }] = await sql<{ id: number }[]>`
      INSERT INTO challenges (uuid, start_time, finish_time, type, scale)
      VALUES (gen_random_uuid(), ${startTime}, ${startTime}, ${ChallengeType.TOB}, 1)
      RETURNING id
    `;
    await sql`
      INSERT INTO challenge_players (challenge_id, player_id, username, orb, primary_gear)
      VALUES (${id}, ${playerId}, ${username}, 0, 1)
    `;
    return id;
  }

  async function makeStats(
    playerId: number,
    ...dates: string[]
  ): Promise<void> {
    if (dates.length === 0) {
      return;
    }
    await sql`
      INSERT INTO player_stats ${sql(
        dates.map((date) => ({ player_id: playerId, date })),
      )}
    `;
  }

  async function makeKeys(
    playerId: number,
    ...lastUsed: string[]
  ): Promise<void> {
    if (lastUsed.length === 0) {
      return;
    }
    await sql`
      INSERT INTO api_keys ${sql(
        lastUsed.map((last_used) => {
          keyCounter += 1;
          return {
            user_id: userId,
            player_id: playerId,
            key: `hist-key-${keyCounter}`,
            last_used,
          };
        }),
      )}
    `;
  }

  afterEach(async () => {
    if (createdPlayerIds.length > 0) {
      await sql`
        DELETE FROM challenges
        WHERE id IN (
          SELECT challenge_id
          FROM challenge_players
          WHERE player_id = ANY(${createdPlayerIds})
        )
      `;
      await sql`DELETE FROM players WHERE id = ANY(${createdPlayerIds})`;
      createdPlayerIds = [];
    }
  });

  // Renames are spaced > 30 days apart, mirroring the OSRS username hold so
  // each name's challenges fall unambiguously in one window.
  const JAN = '2026-01-01';
  const FEB = '2026-02-01';
  const APR = '2026-04-01';
  const JUN = '2026-06-01';

  function transition(
    oldName: string,
    newName: string,
    effectiveFrom: string,
  ): ChainTransition {
    return {
      oldName,
      newName,
      effectiveFrom: new Date(effectiveFrom),
    };
  }

  async function challengesOf(playerId: number): Promise<number[]> {
    const rows = await sql<{ challenge_id: number }[]>`
      SELECT challenge_id FROM challenge_players
      WHERE player_id = ${playerId}
      ORDER BY challenge_id
    `;
    return rows.map((r) => r.challenge_id);
  }

  // The challenges underlying a player's personal best history.
  async function pbChallengesOf(playerId: number): Promise<number[]> {
    const rows = await sql<{ challenge_id: number }[]>`
      SELECT cs.challenge_id
      FROM personal_best_history pbh
      JOIN challenge_splits cs ON cs.id = pbh.challenge_split_id
      WHERE pbh.player_id = ${playerId}
      ORDER BY cs.challenge_id
    `;
    return rows.map((r) => r.challenge_id);
  }

  async function recordingsOf(playerId: number): Promise<number> {
    const [{ total_recordings }] = await sql<[{ total_recordings: number }]>`
      SELECT total_recordings FROM players WHERE id = ${playerId}
    `;
    return total_recordings;
  }

  async function statCountOf(playerId: number): Promise<number> {
    const [{ count }] = await sql<[{ count: string }]>`
      SELECT COUNT(*) FROM player_stats WHERE player_id = ${playerId}
    `;
    return parseInt(count);
  }

  async function keyCountOf(playerId: number): Promise<number> {
    const [{ count }] = await sql<[{ count: string }]>`
      SELECT COUNT(*) FROM api_keys WHERE player_id = ${playerId}
    `;
    return parseInt(count);
  }

  async function playerExists(playerId: number): Promise<boolean> {
    const [row] = await sql<[{ id: number }?]>`
      SELECT id FROM players WHERE id = ${playerId}
    `;
    return row !== undefined;
  }

  async function addSplit(challengeId: number, ticks: number): Promise<number> {
    const [{ id }] = await sql<[{ id: number }]>`
      INSERT INTO challenge_splits (challenge_id, type, scale, ticks, accurate)
      VALUES (${challengeId}, 1, 1, ${ticks}, true)
      RETURNING id
    `;
    return id;
  }

  async function setPb(playerId: number, splitId: number): Promise<void> {
    await sql`
      INSERT INTO personal_best_history (player_id, challenge_split_id, created_at)
      VALUES (${playerId}, ${splitId}, NOW())
    `;
  }

  describe('name change chains', () => {
    describe('nameInWindowsAt', () => {
      const windows = deriveNameWindows([
        transition('Foo', 'Bar', FEB),
        transition('Bar', 'Baz', APR),
      ]);

      it('returns the original name before the first breakpoint', () => {
        expect(nameInWindowsAt(windows, new Date('2026-01-01'))).toBe('foo');
      });

      it('attributes the first breakpoint instant to the original name', () => {
        expect(nameInWindowsAt(windows, new Date(FEB))).toBe('foo');
      });

      it('returns the intermediate name within its window', () => {
        expect(nameInWindowsAt(windows, new Date('2026-03-01'))).toBe('bar');
      });

      it('attributes a later breakpoint instant to the preceding name', () => {
        expect(nameInWindowsAt(windows, new Date(APR))).toBe('bar');
      });

      it('returns the current name after the last breakpoint', () => {
        expect(nameInWindowsAt(windows, new Date('2026-05-01'))).toBe('baz');
      });

      it('returns the reverted name in its later window for a revert chain', () => {
        const revert = deriveNameWindows([
          transition('foo', 'bar', FEB),
          transition('bar', 'foo', APR),
        ]);
        expect(nameInWindowsAt(revert, new Date('2026-01-01'))).toBe('foo');
        expect(nameInWindowsAt(revert, new Date('2026-03-01'))).toBe('bar');
        expect(nameInWindowsAt(revert, new Date('2026-05-01'))).toBe('foo');
      });
    });

    describe('deriveNameWindows', () => {
      it('produces an open-ended first and last window for a single transition', () => {
        const windows = deriveNameWindows([transition('foo', 'bar', FEB)]);
        expect(windows).toEqual([
          { normalizedRsn: 'foo', from: null, to: new Date(FEB) },
          { normalizedRsn: 'bar', from: new Date(FEB), to: null },
        ]);
      });

      it('emits a window per held name bounded by the next breakpoint', () => {
        const windows = deriveNameWindows([
          transition('foo', 'bar', FEB),
          transition('bar', 'baz', APR),
        ]);
        expect(windows).toEqual([
          { normalizedRsn: 'foo', from: null, to: new Date(FEB) },
          {
            normalizedRsn: 'bar',
            from: new Date(FEB),
            to: new Date(APR),
          },
          { normalizedRsn: 'baz', from: new Date(APR), to: null },
        ]);
      });

      it('represents a revert as the same name in two separate windows', () => {
        const windows = deriveNameWindows([
          transition('foo', 'bar', FEB),
          transition('bar', 'foo', APR),
        ]);
        expect(windows.map((w) => w.normalizedRsn)).toEqual([
          'foo',
          'bar',
          'foo',
        ]);
      });

      it('tiles the timeline contiguously', () => {
        const windows = deriveNameWindows([
          transition('foo', 'bar', FEB),
          transition('bar', 'baz', APR),
        ]);
        for (let i = 0; i < windows.length - 1; i++) {
          expect(windows[i].to).toEqual(windows[i + 1].from);
        }
        expect(windows[0].from).toBeNull();
        expect(windows[windows.length - 1].to).toBeNull();
      });

      it('throws on an empty chain', () => {
        expect(() => deriveNameWindows([])).toThrow();
      });
    });

    describe('belongsToChainTarget', () => {
      const windows = deriveNameWindows([
        transition('foo', 'bar', FEB),
        transition('bar', 'baz', APR),
      ]);

      it('matches a name held during its own window', () => {
        expect(
          belongsToChainTarget(windows, 'foo', new Date('2026-01-01')),
        ).toBe(true);
        expect(
          belongsToChainTarget(windows, 'bar', new Date('2026-03-01')),
        ).toBe(true);
        expect(
          belongsToChainTarget(windows, 'baz', new Date('2026-05-01')),
        ).toBe(true);
      });

      it('rejects a chain name used outside its window', () => {
        expect(
          belongsToChainTarget(windows, 'foo', new Date('2026-03-01')),
        ).toBe(false);
        expect(
          belongsToChainTarget(windows, 'bar', new Date('2026-05-01')),
        ).toBe(false);
      });

      it('rejects a name that never appears in the chain', () => {
        expect(
          belongsToChainTarget(windows, 'qux', new Date('2026-03-01')),
        ).toBe(false);
      });
    });

    describe('validateChain', () => {
      it('accepts a well-formed chain', () => {
        expect(validateChain([transition('foo', 'bar', FEB)])).toBeNull();
        expect(
          validateChain([
            transition('foo', 'bar', FEB),
            transition('bar', 'baz', APR),
          ]),
        ).toBeNull();
      });

      it('accepts links that match after normalization', () => {
        expect(
          validateChain([
            transition('foo', 'mid bar', FEB),
            transition('Mid-Bar', 'baz', APR),
          ]),
        ).toBeNull();
      });

      it('rejects an empty chain', () => {
        expect(validateChain([])).toBe('empty');
      });

      it('rejects invalid names', () => {
        expect(validateChain([transition('foo@', 'bar', FEB)])).toBe(
          'invalid_rsn',
        );
        expect(
          validateChain([transition('foo', 'this name is too long', FEB)]),
        ).toBe('invalid_rsn');
      });

      it('rejects out-of-order or coincident transitions', () => {
        expect(
          validateChain([
            transition('foo', 'bar', APR),
            transition('bar', 'baz', FEB),
          ]),
        ).toBe('not_chronological');
        expect(
          validateChain([
            transition('foo', 'bar', FEB),
            transition('bar', 'baz', FEB),
          ]),
        ).toBe('not_chronological');
      });

      it('rejects a broken link between transitions', () => {
        expect(
          validateChain([
            transition('foo', 'bar', FEB),
            transition('qux', 'baz', APR),
          ]),
        ).toBe('inconsistent_link');
      });
    });
  });

  describe('decide', () => {
    it('targets the existing record holding the current name', async () => {
      const [{ id }] = await sql<{ id: number }[]>`
      INSERT INTO players (username, normalized_username)
      VALUES ('baz', ${normalizeRsn('baz')})
      RETURNING id
    `;
      createdPlayerIds.push(id);

      const plan = await decide([
        transition('foo', 'bar', '2026-02-01'),
        transition('bar', 'baz', '2026-04-01'),
      ]);

      expect(plan.target).toEqual({ action: 'use', playerId: id });
    });

    it('plans to create a target when no record holds the current name', async () => {
      const plan = await decide([transition('foo', 'qux', '2026-02-01')]);
      expect(plan.target).toEqual({ action: 'create', currentName: 'qux' });
    });

    it('gathers each scattered record by name window, skipping the target', async () => {
      // The chain foo -> bar -> baz, current record holds baz.
      const targetId = await makePlayer('baz');
      const fooRecordId = await makePlayer('foo');
      const barRecordId = await makePlayer('bar');

      // foo's challenge lives on the foo record (in the foo window).
      const fooChallenge = await makeChallenge(
        fooRecordId,
        'foo',
        '2026-01-15',
      );
      // bar's challenge lives on the bar record (in the bar window).
      const barChallenge = await makeChallenge(
        barRecordId,
        'bar',
        '2026-03-15',
      );
      // baz's challenge is already on the target — not a move.
      await makeChallenge(targetId, 'baz', '2026-05-15');

      const plan = await decide([
        transition('foo', 'bar', FEB),
        transition('bar', 'baz', APR),
      ]);

      // windows[0]=foo, [1]=bar, [2]=baz.
      expect(plan.sourcePlayers).toEqual([
        { playerId: fooRecordId, windowIndex: 0, challengeIds: [fooChallenge] },
        { playerId: barRecordId, windowIndex: 1, challengeIds: [barChallenge] },
      ]);
    });

    it("does not gather a same-named challenge outside the player's window", async () => {
      // Chain foo -> baz, renamed at FEB, so the foo window ends at FEB.
      await makePlayer('baz');
      const foo = await makePlayer('foo');

      const ourChallenge = await makeChallenge(foo, 'foo', '2026-01-15');
      // A later foo challenge falls after the rename: it is no longer the
      // player's, so it is excluded even though it sits on the same record.
      await makeChallenge(foo, 'foo', '2026-05-15');

      const plan = await decide([transition('foo', 'baz', FEB)]);

      expect(plan.sourcePlayers).toEqual([
        { playerId: foo, windowIndex: 0, challengeIds: [ourChallenge] },
      ]);
    });

    it('ignores windows without source records', async () => {
      // Chain foo -> bar -> baz -> qux. The player recorded as foo
      // (window 0) and as baz (window 2) but never as bar (window 1).
      await makePlayer('qux');
      const fooRecordId = await makePlayer('foo');
      const bazRecordId = await makePlayer('baz');
      const fooChallenge = await makeChallenge(
        fooRecordId,
        'foo',
        '2026-01-15',
      );
      const bazChallenge = await makeChallenge(
        bazRecordId,
        'baz',
        '2026-05-15',
      );

      const plan = await decide([
        transition('foo', 'bar', FEB),
        transition('bar', 'baz', APR),
        transition('baz', 'qux', JUN),
      ]);

      // bar window (index 1) is skipped.
      expect(plan.sourcePlayers).toEqual([
        { playerId: fooRecordId, windowIndex: 0, challengeIds: [fooChallenge] },
        { playerId: bazRecordId, windowIndex: 2, challengeIds: [bazChallenge] },
      ]);
    });

    it('marks a source emptied when all of its rows move', async () => {
      // The foo record's only challenge moves to the target, emptying it.
      await makePlayer('baz');
      const fooRecordId = await makePlayer('foo');
      await makeChallenge(fooRecordId, 'foo', '2026-01-15');

      const plan = await decide([
        transition('foo', 'bar', FEB),
        transition('bar', 'baz', APR),
      ]);

      expect(plan.emptiedSourceIds).toEqual([fooRecordId]);
    });

    it('does not mark a source emptied when it keeps a row', async () => {
      // The foo record has one in-window challenge and one later challenge,
      // so it is not emptied.
      await makePlayer('baz');
      const fooRecordId = await makePlayer('foo');
      await makeChallenge(fooRecordId, 'foo', '2026-01-15');
      await makeChallenge(fooRecordId, 'foo', '2026-05-15');

      const plan = await decide([
        transition('foo', 'bar', FEB),
        transition('bar', 'baz', APR),
      ]);

      expect(plan.emptiedSourceIds).toEqual([]);
    });

    it('flags target challenges not belonging to the player for eviction', async () => {
      // Chain bar -> baz -> foo -> baz. During the periods where the player
      // did not hold baz, some other player recorded challenges on it.
      const bazId = await makePlayer('baz');
      const before = await makeChallenge(bazId, 'baz', '2025-12-24');
      const earlyBaz = await makeChallenge(bazId, 'baz', '2026-01-15');
      const between = await makeChallenge(bazId, 'baz', '2026-03-15');
      const currentBaz = await makeChallenge(bazId, 'baz', '2026-05-15');

      const plan = await decide([
        transition('bar', 'baz', JAN),
        transition('baz', 'foo', FEB),
        transition('foo', 'baz', APR),
      ]);

      expect(plan.evictedTargetChallengeIds).toEqual([before, between]);
      expect(plan.evictedTargetChallengeIds).not.toContain(earlyBaz);
      expect(plan.evictedTargetChallengeIds).not.toContain(currentBaz);
    });

    it('evicts nothing from a target that is newly created', async () => {
      const fooRecordId = await makePlayer('foo');
      await makeChallenge(fooRecordId, 'foo', '2026-01-15');
      const plan = await decide([transition('foo', 'qux', FEB)]);
      expect(plan.target).toEqual({ action: 'create', currentName: 'qux' });
      expect(plan.evictedTargetChallengeIds).toEqual([]);
    });
  });

  describe('formatPlan', () => {
    it('reports an existing target with its challenge counts before and after', async () => {
      const targetId = await makePlayer('baz');
      const fooRecordId = await makePlayer('foo');
      // foo (0c) -> bar (1c) -> baz (1c)
      await makeChallenge(targetId, 'baz', '2026-05-15');
      await makeChallenge(fooRecordId, 'foo', '2026-01-15');

      const plan = await decide([
        transition('foo', 'bar', FEB),
        transition('bar', 'baz', APR),
      ]);
      const display = await formatPlan(plan);

      expect(display.target).toEqual({
        name: 'baz',
        isNew: false,
        challengesBefore: 1,
        challengesAfter: 2,
        pbRecomputedFrom: new Date('2026-01-15'),
      });
    });

    it('reports a target that would be created with a zero before count', async () => {
      const fooRecordId = await makePlayer('foo');
      await makeChallenge(fooRecordId, 'foo', '2026-01-15');

      const plan = await decide([transition('foo', 'qux', FEB)]);
      const display = await formatPlan(plan);

      expect(display.target).toEqual({
        name: 'qux',
        isNew: true,
        challengesBefore: 0,
        challengesAfter: 1,
        pbRecomputedFrom: new Date('2026-01-15'),
      });
    });

    it('describes each contribution with in-window stat and key counts', async () => {
      // foo -> bar -> baz (target baz).
      await makePlayer('baz');
      const fooRecordId = await makePlayer('foo');
      const barRecordId = await makePlayer('bar');

      await makeChallenge(fooRecordId, 'foo', '2026-01-10');
      await makeChallenge(fooRecordId, 'foo', '2026-01-20');
      await makeChallenge(barRecordId, 'bar', '2026-03-15');

      // Two foo stats in window, one after the rename.
      await makeStats(fooRecordId, '2026-01-10', '2026-01-20', '2026-05-01');
      // One foo key in window, one after.
      await makeKeys(fooRecordId, '2026-01-15', '2026-05-01');
      // One bar stat in window; no bar keys.
      await makeStats(barRecordId, '2026-03-15');

      const plan = await decide([
        transition('foo', 'bar', FEB),
        transition('bar', 'baz', APR),
      ]);
      const display = await formatPlan(plan);

      expect(display.contributions).toEqual([
        {
          sourceName: 'foo',
          asName: 'foo',
          span: { from: new Date('2026-01-10'), to: new Date('2026-01-20') },
          challenges: 2,
          stats: 2,
          apiKeys: 1,
        },
        {
          sourceName: 'bar',
          asName: 'bar',
          span: { from: new Date('2026-03-15'), to: new Date('2026-03-15') },
          challenges: 1,
          stats: 1,
          apiKeys: 0,
        },
      ]);
    });

    it('summarizes each source with its outcome and pb cutoff date', async () => {
      // foo -> bar -> baz. foo is deleted; bar is kept.
      await makePlayer('baz');
      const fooRecordId = await makePlayer('foo');
      const barRecordId = await makePlayer('bar');

      await makeChallenge(fooRecordId, 'foo', '2026-01-10');
      await makeChallenge(barRecordId, 'bar', '2026-03-15');
      // One later bar challenge.
      await makeChallenge(barRecordId, 'bar', '2026-05-15');

      const plan = await decide([
        transition('foo', 'bar', FEB),
        transition('bar', 'baz', APR),
      ]);
      const display = await formatPlan(plan);

      expect(display.sources).toEqual([
        { name: 'foo', outcome: 'deleted' },
        {
          name: 'bar',
          outcome: 'kept',
          pbRecomputedFrom: new Date('2026-03-15'),
        },
      ]);
    });

    it('reflects a target eviction and surfaces an API key blocker', async () => {
      // Target baz has both a previous challenge and existing API key.
      const bazId = await makePlayer('baz');
      await makeChallenge(bazId, 'baz', '2026-05-15');
      const foreign = await makeChallenge(bazId, 'baz', '2026-01-15');
      const fooId = await makePlayer('foo');
      await makeChallenge(fooId, 'foo', '2026-01-20');
      await makeKeys(bazId, '2026-01-10');

      const plan = await decide([transition('foo', 'baz', FEB)]);
      const display = await formatPlan(plan);

      expect(display.target.challengesBefore).toBe(2);
      expect(display.target.challengesAfter).toBe(2);
      expect(display.evictedChallenges).toBe(1);
      expect(display.unownedApiKeys).toBe(1);
      expect(display.target.pbRecomputedFrom).toEqual(new Date('2026-01-15'));
      expect(plan.evictedTargetChallengeIds).toEqual([foreign]);
    });
  });

  describe('dryRunHistoricNameChange', () => {
    it('rejects a malformed chain without touching the database', async () => {
      const result = await dryRunHistoricNameChange([
        transition('foo', 'bar', APR),
        transition('bar', 'baz', FEB),
      ]);
      expect(result).toEqual({ ok: false, error: 'not_chronological' });
    });

    it('returns the display plan for a valid chain', async () => {
      await makePlayer('baz');
      const fooRecordId = await makePlayer('foo');
      await makeChallenge(fooRecordId, 'foo', '2026-01-15');

      const result = await dryRunHistoricNameChange([
        transition('foo', 'bar', FEB),
        transition('bar', 'baz', APR),
      ]);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.plan.target.name).toBe('baz');
        expect(result.plan.contributions).toHaveLength(1);
        expect(result.plan.sources).toEqual([
          { name: 'foo', outcome: 'deleted' },
        ]);
      }
    });
  });

  describe('apply', () => {
    it('consolidates scattered records onto the current record', async () => {
      // foo -> bar -> baz, current record baz. Each record holds one of the
      // player's challenges, with its stats, key, and a split.
      const bazId = await makePlayer('baz');
      const fooId = await makePlayer('foo');
      const barId = await makePlayer('bar');
      const fooChallenge = await makeChallenge(fooId, 'foo', '2026-01-15');
      const barChallenge = await makeChallenge(barId, 'bar', '2026-03-15');
      const bazChallenge = await makeChallenge(bazId, 'baz', '2026-05-15');
      await addSplit(fooChallenge, 100);
      await addSplit(barChallenge, 90);
      await addSplit(bazChallenge, 110);
      await makeStats(fooId, '2026-01-10');
      await makeStats(barId, '2026-03-10');
      await makeStats(bazId, '2026-05-10');
      await makeKeys(fooId, '2026-01-10');
      await makeKeys(barId, '2026-03-10');
      await makeKeys(bazId, '2026-05-10');
      await sql`UPDATE players SET total_recordings = 1 WHERE id = ANY(${[
        bazId,
        fooId,
        barId,
      ]})`;

      const plan = await decide([
        transition('foo', 'bar', FEB),
        transition('bar', 'baz', APR),
      ]);
      await apply(plan);

      // Everything is now on baz. foo and bar are left as empty husks.
      expect(await challengesOf(bazId)).toEqual(
        [bazChallenge, fooChallenge, barChallenge].sort((a, b) => a - b),
      );
      expect(await challengesOf(fooId)).toEqual([]);
      expect(await challengesOf(barId)).toEqual([]);
      expect(await recordingsOf(bazId)).toBe(3);
      // The moved stats and keys land on baz alongside its own.
      expect(await statCountOf(bazId)).toBe(3);
      expect(await keyCountOf(bazId)).toBe(3);
      // baz's PB ladder is rebuilt over all challenges in time order: 100 is the
      // first best, 90 improves it, 110 does not.
      expect(await pbChallengesOf(bazId)).toEqual(
        [fooChallenge, barChallenge].sort((a, b) => a - b),
      );
    });

    it('creates the current player when none exists and moves data onto it', async () => {
      // foo -> bar, current name bar has no record yet.
      const fooId = await makePlayer('foo');
      const fooChallenge = await makeChallenge(fooId, 'foo', '2026-01-15');
      await addSplit(fooChallenge, 100);
      await makeStats(fooId, '2026-01-10');
      await makeKeys(fooId, '2026-01-10');
      await sql`UPDATE players SET total_recordings = 1 WHERE id = ${fooId}`;

      const plan = await decide([transition('foo', 'bar', FEB)]);
      await apply(plan);

      const [bar] = await sql<[{ id: number }?]>`
        SELECT id FROM players WHERE normalized_username = ${normalizeRsn('bar')}
      `;
      expect(bar).toBeDefined();
      createdPlayerIds.push(bar!.id);

      expect(await challengesOf(bar!.id)).toEqual([fooChallenge]);
      expect(await recordingsOf(bar!.id)).toBe(1);
      expect(await statCountOf(bar!.id)).toBe(1);
      expect(await keyCountOf(bar!.id)).toBe(1);
      expect(await pbChallengesOf(bar!.id)).toEqual([fooChallenge]);
      expect(await challengesOf(fooId)).toEqual([]);
    });

    it('recomputes PBs on both sides when a shared record is split', async () => {
      // Chain someone -> foo (Jan 1) -> baz (Feb 1), target baz. Every challenge
      // is recorded as "foo", but only those in the window (Jan 1..Feb 1) are
      // the target player's; the others belong to the unrelated players.
      const bazId = await makePlayer('baz');
      const fooId = await makePlayer('foo');
      const a = await makeChallenge(fooId, 'foo', '2025-12-01'); // stays, 105
      const b = await makeChallenge(fooId, 'foo', '2026-01-05'); // moves, 80
      const c = await makeChallenge(fooId, 'foo', '2026-01-20'); // moves, 90
      const d = await makeChallenge(fooId, 'foo', '2026-05-10'); // stays, 100
      const e = await makeChallenge(fooId, 'foo', '2026-06-10'); // stays, 70
      const aSplit = await addSplit(a, 105);
      const bSplit = await addSplit(b, 80);
      await addSplit(c, 90);
      await addSplit(d, 100);
      const eSplit = await addSplit(e, 70);
      // foo's PB history as it stands before the migration: chronologically
      // a (105), b (80), and e (70) each set a new best.
      await setPb(fooId, aSplit);
      await setPb(fooId, bSplit);
      await setPb(fooId, eSplit);
      await sql`UPDATE players SET total_recordings = 5 WHERE id = ${fooId}`;
      await sql`UPDATE players SET total_recordings = 0 WHERE id = ${bazId}`;

      const plan = await decide([
        transition('someone', 'foo', '2026-01-01'),
        transition('foo', 'baz', FEB),
      ]);
      await apply(plan);

      // The in-window pair (b, c) moves to baz. b (80) is baz's PB; c (90) is
      // later and worse, so a moved challenge is not blindly a PB.
      expect(await challengesOf(bazId)).toEqual([b, c].sort((x, y) => x - y));
      expect(await pbChallengesOf(bazId)).toEqual([b]);

      // foo keeps the out-of-window challenges (a, d, e). With b gone, its ladder
      // is a (105) then d (100) then e (70), all PBs — d is promoted, having
      // been shadowed by the departed b (80).
      expect(await challengesOf(fooId)).toEqual(
        [a, d, e].sort((x, y) => x - y),
      );
      expect(await pbChallengesOf(fooId)).toEqual(
        [a, d, e].sort((x, y) => x - y),
      );

      expect(await recordingsOf(bazId)).toBe(2);
      expect(await recordingsOf(fooId)).toBe(3);
    });

    it('splits prior history off the target onto a zombie', async () => {
      // foo -> baz, target baz. The baz record holds a past challenge recorded
      // before the player held the name and one from the player. The foreign
      // challenge has a faster split, shadowing the players's actual PB.
      const bazId = await makePlayer('baz');
      const foreign = await makeChallenge(bazId, 'baz', '2026-01-15');
      const genuine = await makeChallenge(bazId, 'baz', '2026-05-15');
      const foreignSplit = await addSplit(foreign, 80);
      await addSplit(genuine, 100);
      await setPb(bazId, foreignSplit);
      // The later snapshot's counters include the prior holder's earlier ones.
      await sql`
        INSERT INTO player_stats (player_id, date, tob_completions, deaths_total)
        VALUES
          (${bazId}, ${new Date('2026-01-10')}, 5, 3),
          (${bazId}, ${new Date('2026-05-10')}, 12, 8)
      `;
      await sql`UPDATE players SET total_recordings = 2 WHERE id = ${bazId}`;

      const plan = await decide([transition('foo', 'baz', FEB)]);
      await apply(plan);

      const [zombie] = await sql<[{ id: number }?]>`
        SELECT id FROM players WHERE normalized_username = ${normalizeRsn('*baz')}
      `;
      expect(zombie).toBeDefined();
      createdPlayerIds.push(zombie!.id);

      // The foreign challenge, its PB, and the prior holder's snapshot move to
      // the zombie unchanged.
      expect(await challengesOf(zombie!.id)).toEqual([foreign]);
      expect(await pbChallengesOf(zombie!.id)).toEqual([foreign]);
      expect(
        await sql`
          SELECT date, tob_completions, deaths_total FROM player_stats
          WHERE player_id = ${zombie!.id}
        `,
      ).toEqual([
        { date: new Date('2026-01-10'), tob_completions: 5, deaths_total: 3 },
      ]);
      expect(await recordingsOf(zombie!.id)).toBe(1);

      // The target keeps its own data with a recomputed PB and stats.
      expect(await challengesOf(bazId)).toEqual([genuine]);
      expect(await pbChallengesOf(bazId)).toEqual([genuine]);
      expect(
        await sql`
          SELECT date, tob_completions, deaths_total FROM player_stats
          WHERE player_id = ${bazId}
        `,
      ).toEqual([
        { date: new Date('2026-05-10'), tob_completions: 7, deaths_total: 5 },
      ]);
      expect(await recordingsOf(bazId)).toBe(1);
    });

    it('refuses to consolidate when a prior holder left API keys', async () => {
      const bazId = await makePlayer('baz');
      const foreign = await makeChallenge(bazId, 'baz', '2026-01-15');
      await makeKeys(bazId, '2026-01-10');

      const plan = await decide([transition('foo', 'baz', FEB)]);
      expect(plan.unownedApiKeyCount).toBe(1);
      await expect(apply(plan)).rejects.toThrow(/API key/);

      expect(await challengesOf(bazId)).toEqual([foreign]);
      const [zombie] = await sql`
        SELECT id FROM players WHERE normalized_username = ${normalizeRsn('*baz')}
      `;
      expect(zombie).toBeUndefined();
    });

    it('refuses to consolidate on a prior holder key with no challenges to evict', async () => {
      const bazId = await makePlayer('baz');
      const genuine = await makeChallenge(bazId, 'baz', '2026-05-15');
      await makeKeys(bazId, '2026-01-10');

      const plan = await decide([transition('foo', 'baz', FEB)]);
      expect(plan.evictedTargetChallengeIds).toEqual([]);
      expect(plan.unownedApiKeyCount).toBe(1);
      await expect(apply(plan)).rejects.toThrow(/API key/);

      expect(await challengesOf(bazId)).toEqual([genuine]);
    });

    it('counts an unused key on the target as unowned', async () => {
      const bazId = await makePlayer('baz');
      const genuine = await makeChallenge(bazId, 'baz', '2026-05-15');
      await sql`
        INSERT INTO api_keys (user_id, player_id, key, last_used)
        VALUES (${userId}, ${bazId}, 'never-used-key', NULL)
      `;

      const plan = await decide([transition('foo', 'baz', FEB)]);
      expect(plan.unownedApiKeyCount).toBe(1);
      await expect(apply(plan)).rejects.toThrow(/API key/);

      expect(await challengesOf(bazId)).toEqual([genuine]);
    });

    it('creates a new zombie even when one already exists for the name', async () => {
      await makePlayer('*baz');
      const bazId = await makePlayer('baz');
      await makeChallenge(bazId, 'baz', '2026-01-15');

      const plan = await decide([transition('foo', 'baz', FEB)]);
      await apply(plan);

      const zombies = await sql<{ id: number }[]>`
        SELECT id FROM players
        WHERE normalized_username = ${normalizeRsn('*baz')}
        ORDER BY id
      `;
      expect(zombies).toHaveLength(2);
      zombies.forEach((z) => createdPlayerIds.push(z.id));
    });
  });

  describe('deleteEmptiedSources', () => {
    it('deletes records with no challenge_players rows', async () => {
      const emptyId = await makePlayer('emptyhusk');
      const deleted = await deleteEmptiedSources([emptyId]);
      expect(deleted).toBe(1);
      expect(await playerExists(emptyId)).toBe(false);
    });

    it('skips records with challenge_players rows', async () => {
      const contestedId = await makePlayer('contested');
      const safeId = await makePlayer('safehusk');
      await makeChallenge(contestedId, 'contested', '2026-05-15');

      const deleted = await deleteEmptiedSources([contestedId, safeId]);
      expect(deleted).toBe(1);
      expect(await playerExists(contestedId)).toBe(true);
      expect(await playerExists(safeId)).toBe(false);
    });

    it('does nothing when empty', async () => {
      const deleted = await deleteEmptiedSources([]);
      expect(deleted).toBe(0);
    });
  });

  describe('processNextHistoricSequence', () => {
    const processor = new NameChangeProcessor({ autoStart: false });

    // Inserts a pending historic sequence.
    async function insertHistoricSequence(
      sequenceId: string,
      chain: ChainTransition[],
    ): Promise<void> {
      const rows = chain.map((t, i) => ({
        player_id: null,
        old_name: t.oldName,
        new_name: t.newName,
        status: NameChangeStatus.PENDING,
        submitted_at: new Date(),
        effective_from: t.effectiveFrom,
        effective_to: i + 1 < chain.length ? chain[i + 1].effectiveFrom : null,
        kind: NameChangeKind.HISTORIC,
        sequence_id: sequenceId,
      }));
      await sql`INSERT INTO name_changes ${sql(rows)}`;
    }

    afterEach(async () => {
      await sql`DELETE FROM name_changes`;
    });

    it('fully applies a pending historic sequence', async () => {
      // foo -> bar -> baz, current record baz. foo's only challenge moves and
      // empties it; bar keeps a later, out-of-window challenge and survives.
      const bazId = await makePlayer('baz');
      const fooId = await makePlayer('foo');
      const barId = await makePlayer('bar');
      const fooChallenge = await makeChallenge(fooId, 'foo', '2026-01-15');
      const barChallenge = await makeChallenge(barId, 'bar', '2026-03-15');
      const barLater = await makeChallenge(barId, 'bar', '2026-05-15');
      const bazChallenge = await makeChallenge(bazId, 'baz', '2026-06-15');
      await addSplit(fooChallenge, 100);
      await addSplit(barChallenge, 90);
      await makeStats(fooId, '2026-01-10');
      await makeKeys(fooId, '2026-01-10');
      await sql`UPDATE players SET total_recordings = 1 WHERE id = ${fooId}`;
      await sql`UPDATE players SET total_recordings = 2 WHERE id = ${barId}`;
      await sql`UPDATE players SET total_recordings = 1 WHERE id = ${bazId}`;

      const sequenceId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
      await insertHistoricSequence(sequenceId, [
        transition('foo', 'bar', FEB),
        transition('bar', 'baz', APR),
      ]);

      const result = await processor.processNextHistoricSequence();
      expect(result).toBe('processed');

      // Everything the player recorded now lives on baz.
      expect(await challengesOf(bazId)).toEqual(
        [fooChallenge, barChallenge, bazChallenge].sort((a, b) => a - b),
      );
      expect(await pbChallengesOf(bazId)).toEqual(
        [fooChallenge, barChallenge].sort((a, b) => a - b),
      );
      expect(await statCountOf(bazId)).toBe(1);
      expect(await keyCountOf(bazId)).toBe(1);
      expect(await recordingsOf(bazId)).toBe(3);

      // foo is emptied and deleted; bar keeps its out-of-window challenge.
      expect(await playerExists(fooId)).toBe(false);
      expect(await playerExists(barId)).toBe(true);
      expect(await recordingsOf(barId)).toBe(1);
      expect(await challengesOf(barId)).toEqual([barLater]);

      // The sequence is accepted and now belongs to the target, so it surfaces
      // as baz's name history.
      const rows = await sql<
        {
          status: number;
          player_id: number;
          processed_at: Date | null;
          migrated_documents: number;
        }[]
      >`
        SELECT status, player_id, processed_at, migrated_documents
        FROM name_changes
        WHERE sequence_id = ${sequenceId}
        ORDER BY effective_from
      `;
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row.status).toBe(NameChangeStatus.ACCEPTED);
        expect(row.player_id).toBe(bazId);
        expect(row.processed_at).not.toBeNull();
        // 2 challenge_players + 1 stat + 1 key + 2 recomputed PBs.
        expect(row.migrated_documents).toBe(6);
      }
    });

    it('ignores standard name changes and reports nothing to do', async () => {
      const playerId = await makePlayer('standalone');
      await sql`
        INSERT INTO name_changes (
          player_id, old_name, new_name, status, submitted_at, effective_from
        ) VALUES (
          ${playerId}, 'standalone', 'renamed',
          ${NameChangeStatus.PENDING}, NOW(), NOW()
        )
      `;

      const result = await processor.processNextHistoricSequence();
      expect(result).toBe('not_found');

      const [row] = await sql<[{ status: number; kind: number }]>`
        SELECT status, kind FROM name_changes WHERE player_id = ${playerId}
      `;
      expect(row.status).toBe(NameChangeStatus.PENDING);
      expect(row.kind).toBe(NameChangeKind.STANDARD);
    });

    it('does not reprocess a previously accepted sequence', async () => {
      const bazId = await makePlayer('baz');
      const fooId = await makePlayer('foo');
      const fooChallenge = await makeChallenge(fooId, 'foo', '2026-01-15');
      await insertHistoricSequence('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', [
        transition('foo', 'baz', FEB),
      ]);

      expect(await processor.processNextHistoricSequence()).toBe('processed');
      const consolidated = await challengesOf(bazId);
      expect(consolidated).toEqual([fooChallenge]);

      // A second pass finds no pending sequence and changes nothing.
      expect(await processor.processNextHistoricSequence()).toBe('not_found');
      expect(await challengesOf(bazId)).toEqual(consolidated);
    });

    it('marks a terminally failing sequence FAILED and moves on to the next', async () => {
      // Failing sequence where the target has a preexsting API key.
      const bazId = await makePlayer('baz');
      await makeChallenge(bazId, 'baz', '2026-01-15');
      await makeKeys(bazId, '2026-01-10');
      await insertHistoricSequence('cccccccc-cccc-cccc-cccc-cccccccccccc', [
        transition('foo', 'baz', FEB),
      ]);

      // Newer, clean sequence.
      const srcId = await makePlayer('srcname');
      const srcChallenge = await makeChallenge(srcId, 'srcname', '2026-05-15');
      await insertHistoricSequence('dddddddd-dddd-dddd-dddd-dddddddddddd', [
        transition('srcname', 'dstname', JUN),
      ]);

      expect(await processor.processNextHistoricSequence()).toBe('failed');
      const failed = await sql<{ status: NameChangeStatus }[]>`
        SELECT status FROM name_changes
        WHERE sequence_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
      `;
      expect(failed.every((r) => r.status === NameChangeStatus.FAILED)).toBe(
        true,
      );

      expect(await processor.processNextHistoricSequence()).toBe('processed');
      const [dst] = await sql<[{ id: number }?]>`
        SELECT id FROM players WHERE normalized_username = ${normalizeRsn('dstname')}
      `;
      expect(dst).toBeDefined();
      createdPlayerIds.push(dst!.id);
      expect(await challengesOf(dst!.id)).toEqual([srcChallenge]);
    });
  });
});

// Close database connection after all tests.
afterAll(async () => {
  await sql.end();
});
