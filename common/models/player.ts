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

  bgsSmacks: { type: Number, default: 0 },
  hammerBops: { type: Number, default: 0 },
  barragesWithoutProperWeapon: { type: Number, default: 0 },

  chinsThrown: { type: Number, default: 0 },
  chinsThrownValue: { type: Number, default: 0 },
  chinsThrownWrongDistance: { type: Number, default: 0 },
});

export const PlayerStats =
  models?.PlayerStats ?? model('PlayerStats', playerStatsSchema);
