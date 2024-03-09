import { Schema, model, models } from 'mongoose';

const playerSchema = new Schema({
  username: { type: String, index: { unique: true } },
  totalRaidsRecorded: {
    type: Number,
    default: 0,
  },
});

export const Player = models?.Player ?? model('Player', playerSchema);

const playerStatsSchema = new Schema({
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

export const PlayerStats =
  models?.PlayerStats ?? model('PlayerStats', playerStatsSchema);
