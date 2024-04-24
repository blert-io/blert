import {
  ApiKeyModel,
  NameChangeModel,
  NameChangeStatus,
  PersonalBestModel,
  PlayerModel,
  PlayerStatsModel,
  RaidModel,
} from '@blert/common';
import { Types } from 'mongoose';

import connectToDatabase from '@/actions/db';
import { processNameChange } from '@/actions/change-name';

describe('changeName', () => {
  let _fetch = global.fetch;
  let oldPlayerId: Types.ObjectId;
  let newPlayerId: Types.ObjectId;
  let otherPlayerId: Types.ObjectId;

  beforeAll(async () => {
    await connectToDatabase();
  });

  afterAll(async () => {
    await mongoose.conn.connection.close();
  });

  beforeEach(async () => {
    const [oldPlayer, newPlayer, otherPlayer] = await PlayerModel.insertMany([
      {
        username: 'old name',
        formattedUsername: 'Old Name',
        totalRaidsRecorded: 2,
      },
      {
        username: 'new name',
        formattedUsername: 'New Name',
        totalRaidsRecorded: 2,
      },
      {
        username: 'somerandom',
        formattedUsername: 'SomeRandom',
        totalRaidsRecorded: 4,
      },
    ]);

    oldPlayerId = oldPlayer._id;
    newPlayerId = newPlayer._id;
    otherPlayerId = otherPlayer._id;

    await ApiKeyModel.insertMany([
      {
        userId: new Types.ObjectId(),
        playerId: oldPlayer._id,
        key: 'old-key',
        active: true,
        lastUsed: new Date('2024-04-21'),
      },
      {
        userId: new Types.ObjectId(),
        playerId: newPlayer._id,
        key: 'new-key',
        active: true,
        lastUsed: new Date('2024-04-23'),
      },
      {
        userId: new Types.ObjectId(),
        playerId: newPlayer._id,
        key: 'new-key-2',
        active: true,
        lastUsed: null,
      },
    ]);

    await PersonalBestModel.insertMany([
      {
        playerId: oldPlayer._id,
        cId: '1',
        type: 1,
        scale: 2,
        time: 100,
      },
      {
        playerId: oldPlayer._id,
        cId: '1',
        type: 2,
        scale: 2,
        time: 100,
      },
      {
        playerId: oldPlayer._id,
        cId: '2',
        type: 3,
        scale: 2,
        time: 100,
      },
      {
        playerId: oldPlayer._id,
        cId: '2',
        type: 5,
        scale: 2,
        time: 100,
      },
      {
        playerId: newPlayer._id,
        cId: '5',
        type: 1,
        scale: 2,
        time: 100,
      },
      {
        playerId: newPlayer._id,
        cId: '3',
        type: 2,
        scale: 2,
        time: 75,
      },
      {
        playerId: newPlayer._id,
        cId: '3',
        type: 3,
        scale: 2,
        time: 200,
      },
      {
        playerId: newPlayer._id,
        cId: '5',
        type: 4,
        scale: 2,
        time: 50,
      },
    ]);

    await RaidModel.insertMany([
      {
        _id: '1',
        partyIds: [oldPlayer._id, otherPlayer._id],
        startTime: new Date('2024-04-21'),
      },
      {
        _id: '2',
        partyIds: [oldPlayer._id],
        startTime: new Date('2024-04-21'),
      },
      {
        _id: '3',
        partyIds: [newPlayer._id, otherPlayer._id],
        startTime: new Date('2024-04-22'),
      },
      {
        _id: '4',
        partyIds: [otherPlayer._id],
        startTime: new Date('2024-04-22'),
      },
      {
        _id: '5',
        partyIds: [otherPlayer._id, newPlayer._id],
        startTime: new Date('2024-04-23'),
      },
    ]);

    await PlayerStatsModel.insertMany([
      {
        playerId: oldPlayer._id,
        date: new Date('2024-04-20'),
        completions: 5,
        wipes: 1,
        deaths: 8,
        hammerBops: 9,
      },
      {
        playerId: oldPlayer._id,
        date: new Date('2024-04-21'),
        completions: 7,
        wipes: 2,
        deaths: 12,
        hammerBops: 10,
      },
      {
        playerId: newPlayer._id,
        date: new Date('2024-04-22'),
        completions: 2,
        wipes: 0,
        deaths: 1,
        hammerBops: 1,
      },
      {
        playerId: newPlayer._id,
        date: new Date('2024-04-23'),
        completions: 5,
        wipes: 2,
        deaths: 4,
        hammerBops: 1,
      },
    ]);
  });

  afterEach(async () => {
    global.fetch = _fetch;
    await Promise.all([
      PlayerModel.deleteMany({}),
      PlayerStatsModel.deleteMany({}),
      PersonalBestModel.deleteMany({}),
      RaidModel.deleteMany({}),
      NameChangeModel.deleteMany({}),
      ApiKeyModel.deleteMany({}),
    ]);
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
        text: () => Promise.resolve('1000,2277,300000000'),
      });

    const request = await NameChangeModel.create({
      oldName: 'Old Name',
      newName: 'New Name',
      playerId: oldPlayerId,
      status: NameChangeStatus.PENDING,
    });

    await processNameChange(request._id);

    // Challenges in which the new player participated should be updated to
    // reference the old player instead.
    const expectedPartiesById: Record<string, Array<Types.ObjectId>> = {
      '1': [oldPlayerId, otherPlayerId],
      '2': [oldPlayerId],
      '3': [oldPlayerId, otherPlayerId],
      '4': [otherPlayerId],
      '5': [otherPlayerId, oldPlayerId],
    };

    const updatedChallenges = await RaidModel.find({}).lean().exec();
    updatedChallenges.forEach((challenge) => {
      expect(challenge.partyIds).toEqual(expectedPartiesById[challenge._id]);
    });

    // Stats accumulated by the new player should be migrated to the old player.
    const expectedStats = [
      {
        playerId: oldPlayerId,
        date: new Date('2024-04-20'),
        completions: 5,
        wipes: 1,
        deaths: 8,
        hammerBops: 9,
      },
      {
        playerId: oldPlayerId,
        date: new Date('2024-04-21'),
        completions: 7,
        wipes: 2,
        deaths: 12,
        hammerBops: 10,
      },
      {
        playerId: oldPlayerId,
        date: new Date('2024-04-22'),
        completions: 9,
        wipes: 2,
        deaths: 13,
        hammerBops: 11,
      },
      {
        playerId: oldPlayerId,
        date: new Date('2024-04-23'),
        completions: 12,
        wipes: 4,
        deaths: 16,
        hammerBops: 11,
      },
    ];
    const updatedPlayerStats = await PlayerStatsModel.find({}, undefined, {
      sort: { date: 1 },
    })
      .lean()
      .exec();
    updatedPlayerStats.forEach((stats, index) => {
      expect(stats).toMatchObject(expectedStats[index]);
    });

    const expectedApiKeys = [
      { playerId: oldPlayerId, key: 'old-key' },
      { playerId: oldPlayerId, key: 'new-key' },
    ];
    const updatedApiKeys = await ApiKeyModel.find({}).lean().exec();
    expect(updatedApiKeys).toHaveLength(expectedApiKeys.length);
    updatedApiKeys.forEach((key, index) => {
      expect(key).toMatchObject(expectedApiKeys[index]);
    });

    const expectedPersonalBests = [
      {
        playerId: oldPlayerId,
        cId: '1',
        type: 1,
        scale: 2,
        time: 100,
      },
      {
        playerId: oldPlayerId,
        cId: '3',
        type: 2,
        scale: 2,
        time: 75,
      },
      {
        playerId: oldPlayerId,
        cId: '2',
        type: 3,
        scale: 2,
        time: 100,
      },
      {
        playerId: oldPlayerId,
        cId: '5',
        type: 4,
        scale: 2,
        time: 50,
      },
      {
        playerId: oldPlayerId,
        cId: '2',
        type: 5,
        scale: 2,
        time: 100,
      },
    ];
    const updatedPersonalBests = await PersonalBestModel.find({}).lean().exec();
    updatedPersonalBests.sort((a, b) => a.type - b.type);
    expect(updatedPersonalBests).toHaveLength(expectedPersonalBests.length);
    updatedPersonalBests.forEach((pb, index) => {
      expect(pb).toMatchObject(expectedPersonalBests[index]);
    });

    const updatedPlayer = await PlayerModel.findById(oldPlayerId);
    expect(updatedPlayer!.username).toBe('new name');
    expect(updatedPlayer!.formattedUsername).toBe('New Name');
    expect(updatedPlayer!.totalRaidsRecorded).toBe(4);

    // All the new player's data following the change date should be deleted.
    const newPlayer = await PlayerModel.findById(newPlayerId);
    expect(newPlayer).toBeNull();
    const newPlayerStats = await PlayerStatsModel.countDocuments({
      playerId: newPlayerId,
    });
    expect(newPlayerStats).toBe(0);
    const newPlayerChallenges = await RaidModel.countDocuments({
      partyIds: newPlayerId,
    });
    expect(newPlayerChallenges).toBe(0);

    const updatedRequest = await NameChangeModel.findById(request._id);
    expect(updatedRequest!.status).toBe(NameChangeStatus.ACCEPTED);
    expect(updatedRequest!.processedAt).not.toBeNull();
    expect(updatedRequest!.migratedDocuments).toBe(10);
  });

  it('succeeds when a player has previously existed with the new name', async () => {
    // Add some data for the new player at an earlier date.
    await PlayerModel.updateOne(
      { _id: newPlayerId },
      { $inc: { totalRaidsRecorded: 2 } },
    );
    await ApiKeyModel.create({
      userId: new Types.ObjectId(),
      playerId: newPlayerId,
      key: 'older-key',
      active: true,
      lastUsed: new Date('2024-03-21'),
    });
    await PersonalBestModel.create({
      playerId: newPlayerId,
      cId: '0',
      type: 6,
      scale: 2,
      time: 33,
    });
    await RaidModel.insertMany([
      {
        _id: '6',
        partyIds: [newPlayerId, otherPlayerId],
        startTime: new Date('2024-03-20'),
      },
      {
        _id: '7',
        partyIds: [newPlayerId, otherPlayerId],
        startTime: new Date('2024-03-20'),
      },
    ]);
    await PlayerStatsModel.insertMany([
      {
        playerId: newPlayerId,
        date: new Date('2024-03-20'),
        completions: 1,
        wipes: 0,
        deaths: 0,
        hammerBops: 0,
      },
      {
        playerId: newPlayerId,
        date: new Date('2024-03-21'),
        completions: 2,
        wipes: 0,
        deaths: 1,
        hammerBops: 1,
      },
    ]);

    // Mock the OSRS Hiscores API responses.
    // First response (old player): doesn't exist.
    // Second response (new player): exists.
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        status: 404,
      })
      .mockResolvedValueOnce({
        text: () => Promise.resolve('1000,2277,300000000'),
      });

    const request = await NameChangeModel.create({
      oldName: 'Old Name',
      newName: 'New Name',
      playerId: oldPlayerId,
      status: NameChangeStatus.PENDING,
    });

    await processNameChange(request._id);

    // Challenges in which the new player participated should be updated to
    // reference the old player instead.
    const expectedPartiesById: Record<string, Array<Types.ObjectId>> = {
      '1': [oldPlayerId, otherPlayerId],
      '2': [oldPlayerId],
      '3': [oldPlayerId, otherPlayerId],
      '4': [otherPlayerId],
      '5': [otherPlayerId, oldPlayerId],
      '6': [newPlayerId, otherPlayerId],
      '7': [newPlayerId, otherPlayerId],
    };

    const updatedChallenges = await RaidModel.find({}).lean().exec();
    updatedChallenges.forEach((challenge) => {
      expect(challenge.partyIds).toEqual(expectedPartiesById[challenge._id]);
    });

    // Stats accumulated by the new player should be migrated to the old player.
    const expectedStats = [
      {
        playerId: newPlayerId,
        date: new Date('2024-03-20'),
        completions: 1,
        wipes: 0,
        deaths: 0,
        hammerBops: 0,
      },
      {
        playerId: newPlayerId,
        date: new Date('2024-03-21'),
        completions: 2,
        wipes: 0,
        deaths: 1,
        hammerBops: 1,
      },
      {
        playerId: oldPlayerId,
        date: new Date('2024-04-20'),
        completions: 5,
        wipes: 1,
        deaths: 8,
        hammerBops: 9,
      },
      {
        playerId: oldPlayerId,
        date: new Date('2024-04-21'),
        completions: 7,
        wipes: 2,
        deaths: 12,
        hammerBops: 10,
      },
      {
        playerId: oldPlayerId,
        date: new Date('2024-04-22'),
        completions: 7,
        wipes: 2,
        deaths: 12,
        hammerBops: 10,
      },
      {
        playerId: oldPlayerId,
        date: new Date('2024-04-23'),
        completions: 10,
        wipes: 4,
        deaths: 15,
        hammerBops: 10,
      },
    ];
    const updatedPlayerStats = await PlayerStatsModel.find({}, undefined, {
      sort: { date: 1 },
    })
      .lean()
      .exec();
    updatedPlayerStats.forEach((stats, index) => {
      expect(stats).toMatchObject(expectedStats[index]);
    });

    const expectedApiKeys = [
      { playerId: oldPlayerId, key: 'old-key' },
      { playerId: oldPlayerId, key: 'new-key' },
      { playerId: newPlayerId, key: 'older-key' },
    ];
    const updatedApiKeys = await ApiKeyModel.find({}).lean().exec();
    expect(updatedApiKeys).toHaveLength(expectedApiKeys.length);
    updatedApiKeys.forEach((key, index) => {
      expect(key).toMatchObject(expectedApiKeys[index]);
    });

    const expectedPersonalBests = [
      {
        playerId: oldPlayerId,
        cId: '1',
        type: 1,
        scale: 2,
        time: 100,
      },
      {
        playerId: oldPlayerId,
        cId: '3',
        type: 2,
        scale: 2,
        time: 75,
      },
      {
        playerId: oldPlayerId,
        cId: '2',
        type: 3,
        scale: 2,
        time: 100,
      },
      {
        playerId: oldPlayerId,
        cId: '5',
        type: 4,
        scale: 2,
        time: 50,
      },
      {
        playerId: oldPlayerId,
        cId: '2',
        type: 5,
        scale: 2,
        time: 100,
      },
      {
        playerId: newPlayerId,
        cId: '0',
        type: 6,
        scale: 2,
        time: 33,
      },
    ];
    const updatedPersonalBests = await PersonalBestModel.find({}).lean().exec();
    updatedPersonalBests.sort((a, b) => a.type - b.type);
    expect(updatedPersonalBests).toHaveLength(expectedPersonalBests.length);
    updatedPersonalBests.forEach((pb, index) => {
      expect(pb).toMatchObject(expectedPersonalBests[index]);
    });

    const updatedPlayer = await PlayerModel.findById(oldPlayerId);
    expect(updatedPlayer!.username).toBe('new name');
    expect(updatedPlayer!.formattedUsername).toBe('New Name');
    expect(updatedPlayer!.totalRaidsRecorded).toBe(4);

    // All the new player's data following the change date should be deleted,
    // but their earlier data should remain.
    const newPlayer = await PlayerModel.findById(newPlayerId);
    expect(newPlayer!.username).toBe('*new name');
    expect(newPlayer!.formattedUsername).toBe('New Name');
    expect(newPlayer!.totalRaidsRecorded).toBe(2);

    const newPlayerStats = await PlayerStatsModel.countDocuments({
      playerId: newPlayerId,
    });
    expect(newPlayerStats).toBe(2);
    const newPlayerChallenges = await RaidModel.countDocuments({
      partyIds: newPlayerId,
    });
    expect(newPlayerChallenges).toBe(2);

    const updatedRequest = await NameChangeModel.findById(request._id);
    expect(updatedRequest!.status).toBe(NameChangeStatus.ACCEPTED);
    expect(updatedRequest!.processedAt).not.toBeNull();
    expect(updatedRequest!.migratedDocuments).toBe(10);
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
        text: () => Promise.resolve('1000,2277,300000000'),
      });

    const request = await NameChangeModel.create({
      oldName: 'Old Name',
      newName: 'Novel',
      playerId: oldPlayerId,
      status: NameChangeStatus.PENDING,
    });

    await processNameChange(request._id);

    const updatedPlayer = await PlayerModel.findById(oldPlayerId);
    expect(updatedPlayer!.username).toBe('novel');
    expect(updatedPlayer!.formattedUsername).toBe('Novel');
    expect(updatedPlayer!.totalRaidsRecorded).toBe(2);

    const updatedRequest = await NameChangeModel.findById(request._id);
    expect(updatedRequest!.status).toBe(NameChangeStatus.ACCEPTED);
    expect(updatedRequest!.processedAt).not.toBeNull();
    expect(updatedRequest!.migratedDocuments).toBe(0);
  });

  it('fails with OLD_STILL_IN_USE if old player is on hiscores', async () => {
    // Mock the OSRS Hiscores API response.
    global.fetch = jest.fn().mockResolvedValue({
      text: () => Promise.resolve('1000,2277,300000000'),
    });

    const request = await NameChangeModel.create({
      oldName: 'old name',
      newName: 'new name',
      playerId: oldPlayerId,
      status: NameChangeStatus.PENDING,
    });

    await processNameChange(request._id);

    const updatedRequest = await NameChangeModel.findById(request._id);
    expect(updatedRequest!.status).toBe(NameChangeStatus.OLD_STILL_IN_USE);
    expect(updatedRequest!.processedAt).not.toBeNull();
    expect(updatedRequest!.migratedDocuments).toBe(0);
  });

  it('fails with NEW_DOES_NOT_EXIST if new player is not on hiscores', async () => {
    // Mock the OSRS Hiscores API response.
    global.fetch = jest.fn().mockResolvedValue({ status: 404 });

    const request = await NameChangeModel.create({
      oldName: 'old name',
      newName: 'new name',
      playerId: oldPlayerId,
      status: NameChangeStatus.PENDING,
    });

    await processNameChange(request._id);

    const updatedRequest = await NameChangeModel.findById(request._id);
    expect(updatedRequest!.status).toBe(NameChangeStatus.NEW_DOES_NOT_EXIST);
    expect(updatedRequest!.processedAt).not.toBeNull();
    expect(updatedRequest!.migratedDocuments).toBe(0);
  });
});
