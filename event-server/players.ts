import {
  PlayerModel,
  PlayerStatsModel,
  PlayerStats,
  Player,
  TobPbs,
  Mode,
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

function pbKey(mode: Mode.REGULAR | Mode.HARD, scale: number): keyof TobPbs {
  switch (scale) {
    case 1:
      return mode === Mode.REGULAR ? 'regSolo' : 'hmtSolo';
    case 2:
      return mode === Mode.REGULAR ? 'regDuo' : 'hmtDuo';
    case 3:
      return mode === Mode.REGULAR ? 'regTrio' : 'hmtTrio';
    case 4:
      return mode === Mode.REGULAR ? 'regFours' : 'hmtFours';
    case 5:
      return mode === Mode.REGULAR ? 'regFives' : 'hmtFives';
  }

  throw new Error(`Invalid scale: ${scale}`);
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
      personalBests: {
        theatreOfBlood: {
          regSolo: null,
          regDuo: null,
          regTrio: null,
          regFours: null,
          regFives: null,
          hmtSolo: null,
          hmtDuo: null,
          hmtTrio: null,
          hmtFours: null,
          hmtFives: null,
        },
      },
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
   * Updates a player's personal best for a given mode and scale, if the given
   * time is better than their current personal best.
   *
   * @param username The player's username.
   * @param mode The raid mode.
   * @param scale The raid scale.
   * @param roomTicks Raid completion time.
   */
  public static async updatePersonalBest(
    username: string,
    mode: Mode,
    scale: number,
    roomTicks: number,
  ): Promise<void> {
    const player = await PlayerModel.findOne({
      username: username.toLowerCase(),
    }).exec();
    if (player === null || mode === Mode.ENTRY) {
      return;
    }

    const key = pbKey(mode, scale);
    const currentPb = player.personalBests.theatreOfBlood[key];
    if (currentPb === null || roomTicks < currentPb) {
      player.personalBests.theatreOfBlood[key] = roomTicks;
      await player.save();
    }
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
