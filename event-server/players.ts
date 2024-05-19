import {
  PlayerModel,
  PlayerStatsModel,
  PlayerStats,
  Player,
  PersonalBestType,
  PersonalBestModel,
} from '@blert/common';
import { HydratedDocument, Types } from 'mongoose';

export type PlayerStatsWithoutPlayerOrDate = Omit<
  PlayerStats,
  'date' | 'playerId'
>;

function startOfDateUtc(): Date {
  let date = new Date();
  date.setUTCHours(0);
  date.setUTCMinutes(0);
  date.setUTCSeconds(0);
  date.setUTCMilliseconds(0);
  return date;
}

export class Players {
  public static async findById(
    id: Types.ObjectId,
    projection?: { [field in keyof Player]?: number },
  ): Promise<HydratedDocument<Player> | null> {
    return PlayerModel.findById(id, projection).exec();
  }

  /**
   * Creates a new player in the database.
   * @param username The in-game username of the player.
   * @param initialFields Optional fields to set on the new player.
   * @returns Whether the player was created successfully.
   */
  public static async create(
    username: string,
    initialFields?: Partial<Player>,
  ): Promise<Types.ObjectId | null> {
    const player = new PlayerModel({
      ...initialFields,
      username: username.toLowerCase(),
      formattedUsername: username,
    });
    try {
      player.save();
      return player._id;
    } catch (e) {
      return null;
    }
  }

  public static async startNewRaid(
    username: string,
  ): Promise<Types.ObjectId | null> {
    const player = await PlayerModel.findOneAndUpdate(
      { username: username.toLowerCase() },
      { $inc: { totalRaidsRecorded: 1 } },
    ).exec();

    if (player !== null) {
      return player._id;
    }

    return await Players.create(username, { totalRaidsRecorded: 1 });
  }

  /**
   * Updates players' personal bests for a given category, if the provided time
   * is better than their current personal bests.
   *
   * @param usernames The players.
   * @param challengeId ID of the challenge in which the time was achieved.
   * @param type Type of personal best.
   * @param scale Raid scale.
   * @param ticks The achieved time, in ticks.
   */
  public static async updatePersonalBests(
    usernames: string[],
    challengeId: string,
    type: PersonalBestType,
    scale: number,
    ticks: number,
  ): Promise<void> {
    usernames = usernames.map((u) => u.toLowerCase());
    const players = await PlayerModel.find(
      { username: { $in: usernames } },
      { _id: 1, username: 1 },
    ).exec();
    const playersById = new Map<string, string>();
    players.forEach((p) => playersById.set(p._id.toString(), p.username));

    let personalBests = await PersonalBestModel.find({
      playerId: { $in: Array.from(playersById.keys()) },
      type,
      scale,
    }).exec();

    const promises = [];

    for (const pb of personalBests) {
      const username = playersById.get(pb.playerId.toString());
      if (username === undefined) {
        // A missing username indicates that the player already had a PB in the
        // list and was deleted from the map in a previous iteration. Somehow,
        // the player has multiple PBs for the same category. Correct this.
        console.log(
          `Duplicate PB (${type}, ${scale}) for ${pb.playerId.toString()}; deleting.`,
        );
        await pb.deleteOne().exec();
        continue;
      }

      if (ticks < pb.time) {
        console.log(
          `Updating PB for ${username} (${type}, ${scale}) to ${ticks}`,
        );
        pb.time = ticks;
        pb.cId = challengeId;
        promises.push(pb.save());
      } else {
        console.log(
          `PB for ${username} (${type}, ${scale}) is already better: ${pb.time}`,
        );
      }

      playersById.delete(pb.playerId.toString());
    }

    // Any remaining users are missing a personal best for this category; create
    // one for them.
    playersById.forEach((username, id) => {
      console.log(`Setting PB for ${username} (${type}, ${scale}) to ${ticks}`);
      const pb = new PersonalBestModel({
        playerId: id,
        type,
        cId: challengeId,
        scale,
        time: ticks,
      });
      promises.push(pb.save());
    });

    await Promise.all(promises);
  }

  /**
   * Modifies a player's stats in the database.
   *
   * @param username The player whose stats to update.
   * @param callback Updater function which modifies the stats in-place.
   */
  public static async updateStats(
    username: string,
    callback: (stats: PlayerStatsWithoutPlayerOrDate) => void,
  ): Promise<void> {
    username = username.toLowerCase();
    const player = await PlayerModel.findOne({ username }, { _id: 1 }).exec();
    if (player === null) {
      console.error(`Failed to update stats for missing player ${username}`);
      return;
    }

    let playerStats = await PlayerStatsModel.findOne({ playerId: player._id })
      .sort({ date: -1 })
      .exec();

    const startOfDay = startOfDateUtc();

    if (playerStats !== null) {
      // A new player stats object should be created each day. If the found
      // object is from a previous date, create a new one, copying all fields.
      const statsCreatedToday =
        playerStats.date.getTime() === startOfDay.getTime();

      if (!statsCreatedToday) {
        let obj = playerStats.toObject() as any;
        delete obj._id;
        obj.date = startOfDay;
        playerStats = new PlayerStatsModel(obj);
      }
    } else {
      // No object exists, create a new one.
      playerStats = new PlayerStatsModel({
        playerId: player._id,
        date: startOfDay,
      });
    }

    callback(playerStats);

    playerStats.save();
  }
}

type ActivePlayer = {
  challengeId: string;
};

type PlayerStatusCallback = (challengeId: string | null) => void;

export class PlayerManager {
  private activePlayers = new Map<string, ActivePlayer>();

  private statusUpdateListeners = new Map<string, PlayerStatusCallback[]>();

  public setPlayerActive(username: string, challengeId: string): void {
    this.activePlayers.set(username.toLowerCase(), { challengeId });
    this.statusUpdateListeners
      .get(username.toLowerCase())
      ?.forEach((cb) => cb(challengeId));
  }

  public setPlayerInactive(username: string, challengeId: string): void {
    username = username.toLowerCase();
    const activePlayer = this.activePlayers.get(username);
    if (activePlayer === undefined) {
      return;
    }
    if (activePlayer.challengeId !== challengeId) {
      console.error(
        `Tried to remove ${username} from challenge ${challengeId}, ` +
          `but they are in ${activePlayer.challengeId}`,
      );
      return;
    }
    this.activePlayers.delete(username);
    this.statusUpdateListeners
      .get(username.toLowerCase())
      ?.forEach((cb) => cb(null));
  }

  public getCurrentChallengeId(username: string): string | undefined {
    return this.activePlayers.get(username.toLowerCase())?.challengeId;
  }

  public subscribeToPlayer(
    username: string,
    callback: PlayerStatusCallback,
  ): void {
    username = username.toLowerCase();
    if (!this.statusUpdateListeners.has(username)) {
      this.statusUpdateListeners.set(username, []);
    }

    this.statusUpdateListeners.get(username)!.push(callback);
  }

  public unsubscribeFromPlayer(
    username: string,
    callback: PlayerStatusCallback,
  ): void {
    username = username.toLowerCase();
    if (!this.statusUpdateListeners.has(username)) {
      return;
    }

    const listeners = this.statusUpdateListeners.get(username)!;
    const index = listeners.indexOf(callback);
    if (index !== -1) {
      listeners.splice(index, 1);
    }
  }
}
