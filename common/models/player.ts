import { Model, Schema, Types, model, models } from 'mongoose';

import { Player, PlayerStats } from '../player';

type PlayerSchema = Player & {
  formattedUsername: string;
  totalRaidsRecorded: number;
};

const playerSchema = new Schema<PlayerSchema>({
  username: {
    type: String,
    index: { unique: true },
  },
  formattedUsername: String,
  totalRaidsRecorded: {
    type: Number,
    default: 0,
  },
  overallExperience: {
    type: Number,
    default: 0,
  },
});

export const PlayerModel =
  (models?.Player as Model<PlayerSchema>) ??
  model<PlayerSchema>('Player', playerSchema);

type PlayerStatsSchema = PlayerStats & {
  playerId: Types.ObjectId;
  completions: number;
  wipes: number;
  resets: number;
  deaths: number;
  barragesWithoutProperWeapon: number;
};

const playerStatsSchema = new Schema<PlayerStatsSchema>({
  // @ts-ignore
  playerId: { type: Schema.Types.ObjectId, ref: 'Player', index: true },
  date: { type: Date, index: true },

  completions: { type: Number, default: 0 },
  wipes: { type: Number, default: 0 },
  resets: { type: Number, default: 0 },

  deaths: { type: Number, default: 0 },
  deathsMaiden: { type: Number, default: 0 },
  deathsBloat: { type: Number, default: 0 },
  deathsNylocas: { type: Number, default: 0 },
  deathsSotetseg: { type: Number, default: 0 },
  deathsXarpus: { type: Number, default: 0 },
  deathsVerzik: { type: Number, default: 0 },

  bgsSmacks: { type: Number, default: 0 },
  hammerBops: { type: Number, default: 0 },
  unchargedScytheSwings: { type: Number, default: 0 },
  barragesWithoutProperWeapon: { type: Number, default: 0 },

  chinsThrown: { type: Number, default: 0 },
  chinsThrownBlack: { type: Number, default: 0 },
  chinsThrownRed: { type: Number, default: 0 },
  chinsThrownGrey: { type: Number, default: 0 },
  chinsThrownMaiden: { type: Number, default: 0 },
  chinsThrownNylocas: { type: Number, default: 0 },
  chinsThrownValue: { type: Number, default: 0 },
  chinsThrownIncorrectlyMaiden: { type: Number, default: 0 },
});

export const PlayerStatsModel =
  (models?.PlayerStats as Model<PlayerStatsSchema>) ??
  model<PlayerStatsSchema>('PlayerStats', playerStatsSchema);
