import {
  PlayerModel,
  PlayerStatsModel,
  PlayerStats,
  Player,
  PersonalBestType,
  PersonalBestModel,
} from '@blert/common';

type PlayerStatsWithoutUsernameOrDate = Omit<PlayerStats, 'date' | 'username'>;

function startOfDateUtc(): Date {
  let date = new Date();
  date.setUTCHours(0);
  date.setUTCMinutes(0);
  date.setUTCSeconds(0);
  date.setUTCMilliseconds(0);
  return date;
}

export class Players {
  /**
   * Creates a new player in the database.
   * @param username The in-game username of the player.
   * @param initialFields Optional fields to set on the new player.
   * @returns Whether the player was created successfully.
   */
  public static async create(
    username: string,
    initialFields?: Partial<Player>,
  ): Promise<boolean> {
    const player = new PlayerModel({
      ...initialFields,
      username: username.toLowerCase(),
      formattedUsername: username,
    });
    try {
      player.save();
      return true;
    } catch (e) {
      return false;
    }
  }

  public static async startNewRaid(username: string): Promise<void> {
    const player = await PlayerModel.findOneAndUpdate(
      { username: username.toLowerCase() },
      { $inc: { totalRaidsRecorded: 1 } },
    ).exec();

    if (player === null) {
      await Players.create(username, { totalRaidsRecorded: 1 });
    }
  }

  /**
   * Updates players' personal bests for a given category, if the provided time
   * is better than their current personal bests.
   *
   * @param usernames The players.
   * @param raidId ID of the raid in which the time was achieved.
   * @param type Type of personal best.
   * @param scale Raid scale.
   * @param ticks The achieved time, in ticks.
   */
  public static async updatePersonalBests(
    usernames: string[],
    raidId: string,
    type: PersonalBestType,
    scale: number,
    ticks: number,
  ): Promise<void> {
    const users = new Set(usernames.map((u) => u.toLowerCase()));

    let personalBests = await PersonalBestModel.find({
      username: { $in: Array.from(users.values()) },
      type,
      scale,
    }).exec();

    const promises = [];

    for (const pb of personalBests) {
      if (ticks < pb.time) {
        console.log(
          `Updating PB for ${pb.username} (${type}, ${scale}) to ${ticks}`,
        );
        pb.time = ticks;
        pb.raidId = raidId;
        promises.push(pb.save());
      }
      users.delete(pb.username);
    }

    // Any remaining users are missing a personal best for this category; create
    // one for them.
    users.forEach((username) => {
      console.log(`Setting PB for ${username} (${type}, ${scale}) to ${ticks}`);
      const pb = new PersonalBestModel({
        username,
        type,
        scale,
        time: ticks,
        raidId,
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
    callback: (stats: PlayerStatsWithoutUsernameOrDate) => void,
  ): Promise<void> {
    username = username.toLowerCase();
    let playerStats = await PlayerStatsModel.findOne({ username })
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
      playerStats = new PlayerStatsModel({ username, date: startOfDay });
    }

    callback(playerStats);

    playerStats.save();
  }
}
