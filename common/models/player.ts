import { Model, Schema, model, models } from 'mongoose';

import { Player, PlayerStats } from '../player';

const playerSchema = new Schema<Player>({
  username: {
    type: String,
    index: { unique: true },
  },
  formattedUsername: String,
  totalRaidsRecorded: {
    type: Number,
    default: 0,
  },
  personalBests: {
    theatreOfBlood: {
      regSolo: { type: Number, default: null },
      regDuo: { type: Number, default: null },
      regTrio: { type: Number, default: null },
      regFours: { type: Number, default: null },
      regFives: { type: Number, default: null },
      hmtSolo: { type: Number, default: null },
      hmtDuo: { type: Number, default: null },
      hmtTrio: { type: Number, default: null },
      hmtFours: { type: Number, default: null },
      hmtFives: { type: Number, default: null },
    },
  },
});

export const PlayerModel =
  (models?.Player as Model<Player>) ?? model<Player>('Player', playerSchema);

const playerStatsSchema = new Schema<PlayerStats>({
  username: { type: String, index: true },
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
  (models?.PlayerStats as Model<PlayerStats>) ??
  model<PlayerStats>('PlayerStats', playerStatsSchema);
