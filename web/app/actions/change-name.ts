'use server';

import {
  ApiKeyModel,
  NameChangeModel,
  NameChangeStatus,
  PersonalBestModel,
  PlayerModel,
  PlayerStats,
  PlayerStatsModel,
  RaidModel,
} from '@blert/common';
import { Types } from 'mongoose';

const OSRS_HISCORES_API =
  'https://secure.runescape.com/m=hiscore_oldschool/index_lite.ws';

/**
 * Looks up a player's overall experience on the OSRS hiscores.
 *
 * @param username OSRS username of the account.
 * @returns The overall experience of the account, or null if the account does
 *     not exist.
 */
async function hiscoreLookup(username: string): Promise<number | null> {
  const response = await fetch(`${OSRS_HISCORES_API}?player=${username}`);
  if (response.status === 404) {
    return null;
  }

  const text = await response.text().then((t) => t.split('\n'));
  const overall = text[0].split(',');
  const overallExp = parseInt(overall[2]);
  return overallExp;
}

async function updatePlayerStats(
  oldPlayerId: Types.ObjectId,
  newPlayerId: Types.ObjectId,
  fromDate: Date,
): Promise<number> {
  const lastStats = await PlayerStatsModel.findOne({
    playerId: oldPlayerId,
    date: { $lte: fromDate },
  })
    .sort({ date: -1 })
    .lean()
    .exec();

  const newPlayerLastStats = await PlayerStatsModel.findOne({
    playerId: newPlayerId,
    date: { $lte: fromDate },
  })
    .sort({ date: -1 })
    .lean()
    .exec();

  const statsToMigrate = await PlayerStatsModel.find({
    playerId: newPlayerId,
    date: { $gt: fromDate },
  }).exec();

  const migrations: Array<Promise<any>> = [];

  // Reassign the new player's stats to the old player, adjusting the values by
  // the difference accumulated since the fromDate.
  statsToMigrate.forEach((stats) => {
    const asObject = stats.toObject();
    const newStats: Record<string, number> = {};

    Object.entries(asObject).forEach(([k, value]) => {
      const key = k as keyof PlayerStats;
      if (typeof value !== 'number') {
        return;
      }

      const base = (newPlayerLastStats?.[key] as number | undefined) ?? 0;
      const delta = value - base;
      const old = (lastStats?.[key] as number | undefined) ?? 0;
      newStats[key] = old + delta;
    });

    migrations.push(
      PlayerStatsModel.updateOne(
        { _id: stats._id },
        {
          $set: {
            ...newStats,
            playerId: oldPlayerId,
          },
        },
      ).exec(),
    );
  });

  const { deletedCount } = await PlayerStatsModel.deleteMany({
    playerId: newPlayerId,
    date: { $gt: fromDate },
  });

  return statsToMigrate.length + deletedCount;
}

async function updateApiKeys(
  oldPlayerId: Types.ObjectId,
  newPlayerId: Types.ObjectId,
  fromDate: Date,
): Promise<number> {
  const keysToUpdate = await ApiKeyModel.find({
    playerId: newPlayerId,
    lastUsed: { $gt: fromDate },
  }).exec();

  await Promise.all([
    keysToUpdate.map((key) => {
      key.playerId = oldPlayerId;
      return key.save();
    }),
  ]);

  // Delete unused keys for the new player.
  const { deletedCount } = await ApiKeyModel.deleteMany({
    playerId: newPlayerId,
    lastUsed: null,
  }).exec();

  return keysToUpdate.length + deletedCount;
}

async function updatePersonalBests(
  oldPlayerId: Types.ObjectId,
  newPlayerId: Types.ObjectId,
  challenges: string[],
): Promise<number> {
  const personalBests = await PersonalBestModel.find({
    playerId: newPlayerId,
    cId: { $in: challenges },
  }).exec();

  for (const pb of personalBests) {
    const oldPb = await PersonalBestModel.findOne({
      playerId: oldPlayerId,
      type: pb.type,
      scale: pb.scale,
    }).exec();

    // Either delete or migrate the new player's PBs to the old player.
    if (oldPb === null || oldPb.time > pb.time) {
      pb.playerId = oldPlayerId;
      await Promise.all([pb.save(), oldPb?.deleteOne()]);
    } else {
      await pb.deleteOne();
    }
  }

  // TODO(frolv): If a player with the new name existed before, any PBs that
  // were migrated should be recalculated from their earlier challenges.

  return personalBests.length;
}

export async function processNameChange(changeId: Types.ObjectId) {
  const nameChange = await NameChangeModel.findById(changeId);
  if (nameChange === null) {
    console.log(`Name change not found: ${changeId}`);
    return;
  }

  console.log(
    `Processing name change request: ${nameChange.oldName} -> ${nameChange.newName}`,
  );

  const [expOld, expNew] = await Promise.all([
    hiscoreLookup(nameChange.oldName),
    hiscoreLookup(nameChange.newName),
  ]);

  if (expOld !== null) {
    nameChange.status = NameChangeStatus.OLD_STILL_IN_USE;
  } else if (expNew === null) {
    nameChange.status = NameChangeStatus.NEW_DOES_NOT_EXIST;
  }

  // TODO(frolv): Implement experience check.

  if (nameChange.status !== NameChangeStatus.PENDING) {
    nameChange.processedAt = new Date();
    await nameChange.save();
    console.log(`Name change failed: ${nameChange.status}`);
    return;
  }

  const player = await PlayerModel.findById(nameChange.playerId);
  if (player === null) {
    console.error(
      `Player for name change does not exist: ${nameChange.oldName}`,
    );
    nameChange.deleteOne();
    return;
  }

  let migratedDocuments = 0;

  const newPlayer = await PlayerModel.findOne({
    username: nameChange.newName.toLowerCase(),
  });
  if (newPlayer !== null) {
    let newPlayerPreviouslyExisted = false;
    let challengesUpdated = 0;

    const lastRecordedChallenge = await RaidModel.findOne(
      { partyIds: player._id },
      { startTime: 1 },
    ).sort({ startTime: -1 });

    if (lastRecordedChallenge !== null) {
      const challengesToUpdate = await RaidModel.find({
        partyIds: newPlayer._id,
        startTime: { $gt: lastRecordedChallenge.startTime },
      });

      const challengesBefore = await RaidModel.countDocuments({
        partyIds: newPlayer._id,
        startTime: { $lte: lastRecordedChallenge.startTime },
      });
      newPlayerPreviouslyExisted = challengesBefore > 0;
      const challengeIds = challengesToUpdate.map((c) => c._id);

      console.log(
        `Player ${newPlayer.username} has recorded ${challengesToUpdate.length} challenges since name change`,
      );

      await Promise.all([
        challengesToUpdate.map((c) => {
          c.partyIds = c.partyIds.map((id) =>
            id.equals(newPlayer._id) ? player._id : id,
          );
          return c.save();
        }),
      ]);

      const modifiedDocuments = await Promise.all([
        updatePlayerStats(
          player._id,
          newPlayer._id,
          lastRecordedChallenge.startTime,
        ),
        updateApiKeys(
          player._id,
          newPlayer._id,
          lastRecordedChallenge.startTime,
        ),
        updatePersonalBests(player._id, newPlayer._id, challengeIds),
      ]);

      challengesUpdated = challengesToUpdate.length;

      migratedDocuments += challengesUpdated;
      migratedDocuments += modifiedDocuments.reduce((a, b) => a + b, 0);
    }

    player.totalRaidsRecorded += challengesUpdated;

    if (newPlayerPreviouslyExisted) {
      // The username was previously used by another player who has not updated
      // their username. Keep the old player around in a "zombie" state. This is
      // denoted by prefixing the username with an asterisk, which is not a
      // valid character in OSRS usernames.
      console.log(
        `Previously-existing "${newPlayer.username}" has been renamed to "*${newPlayer.username}"`,
      );
      newPlayer.username = `*${newPlayer.username}`;
      newPlayer.totalRaidsRecorded -= challengesUpdated;
      await newPlayer.save();
    } else {
      await newPlayer.deleteOne();
    }
  }

  player.username = nameChange.newName.toLowerCase();
  player.formattedUsername = nameChange.newName;
  nameChange.status = NameChangeStatus.ACCEPTED;
  nameChange.processedAt = new Date();
  nameChange.migratedDocuments = migratedDocuments;
  await Promise.all([player.save(), nameChange.save()]);
  console.log(
    `Name change accepted: ${nameChange.oldName} -> ${nameChange.newName}`,
  );
}

const RSN_REGEX = /^[a-zA-Z0-9 _-]{1,12}$/;

export async function submitNameChangeForm(
  _state: string | null,
  formData: FormData,
): Promise<string | null> {
  const oldName = formData.get('blert-old-name') as string;
  const newName = formData.get('blert-new-name') as string;

  if (!RSN_REGEX.test(oldName)) {
    return 'Invalid old name';
  }
  if (!RSN_REGEX.test(newName)) {
    return 'Invalid new name';
  }

  const player = await PlayerModel.findOne({ username: oldName.toLowerCase() });
  if (player === null) {
    return 'No Blert player found with that name';
  }

  const nameChange = new NameChangeModel({
    status: NameChangeStatus.PENDING,
    oldName,
    newName,
    playerId: player._id,
  });
  await nameChange.save();

  processNameChange(nameChange._id);
  return null;
}
