import {
  ApiKey,
  ApiKeyModel,
  Raid,
  RaidModel,
  RecordedRaidModel,
  UserModel,
} from '@blert/common';
import { HydratedDocument } from 'mongoose';

export type BasicUser = {
  id: string;
  username: string;
};

export type PastRaid = Pick<Raid, 'stage' | 'status' | 'mode' | 'party'> & {
  id: string;
};

export class Users {
  /**
   * Fetches basic information about a user from their API key.
   *
   * @param apiKey The API key to look up.
   * @returns The user's basic information, or null if the key is invalid.
   */
  static async findByApiKey(apiKey: string): Promise<BasicUser | null> {
    const key = await ApiKeyModel.findById<HydratedDocument<ApiKey>>(apiKey);
    if (key === null) {
      return null;
    }

    const user = await UserModel.findById(key.userId, { username: 1 });
    if (user === null) {
      console.error(`API key ${apiKey} does not belong to a user; deleting.`);
      await key.deleteOne();
      return null;
    }

    return { id: user._id.toString(), username: user.username };
  }

  /**
   * Retrieves the most recent raids recorded by a user.
   *
   * @param userId ID of the user to look up.
   * @param limit Maximum number of raids to return.
   * @returns List of raids, ordered by most recent first.
   */
  static async getRaidHistory(
    userId: string,
    limit: number = 10,
  ): Promise<PastRaid[]> {
    const recordedRaids = await RecordedRaidModel.find(
      { recorderId: userId },
      { _id: false, raidId: true },
    )
      .sort({ _id: -1 })
      .limit(limit)
      .exec();

    const raidIds = recordedRaids.map((r) => r.raidId);
    const raids = await RaidModel.find<Raid>(
      { _id: { $in: raidIds } },
      { stage: 1, status: 1, mode: 1, party: 1, startTime: 1 },
    ).exec();

    raids.sort((a, b) => b.startTime.getTime() - a.startTime.getTime());

    return raids.map((r) => ({
      id: r._id,
      stage: r.stage,
      status: r.status,
      mode: r.mode,
      party: r.party,
    }));
  }
}
