import { PlayerModel, PlayerStatsModel, PlayerStats } from '@blert/common';

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
  public static async startNewRaid(username: string): Promise<void> {
    await PlayerModel.findOneAndUpdate(
      { username },
      { $inc: { totalRaidsRecorded: 1 } },
      { upsert: true },
    ).exec();
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
        let obj = playerStats.toObject();
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
