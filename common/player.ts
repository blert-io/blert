import { Types } from 'mongoose';

export type Player = {
  _id: Types.ObjectId;
  username: string;
  formattedUsername: string;
  totalRaidsRecorded: number;
};

export type PlayerStats = {
  playerId: Types.ObjectId;
  date: Date;

  completions: number;
  wipes: number;
  resets: number;

  deaths: number;
  deathsMaiden: number;
  deathsBloat: number;
  deathsNylocas: number;
  deathsSotetseg: number;
  deathsXarpus: number;
  deathsVerzik: number;

  bgsSmacks: number;
  hammerBops: number;
  unchargedScytheSwings: number;
  barragesWithoutProperWeapon: number;

  chinsThrown: number;
  chinsThrownBlack: number;
  chinsThrownRed: number;
  chinsThrownGrey: number;
  chinsThrownMaiden: number;
  chinsThrownNylocas: number;
  chinsThrownValue: number;
  chinsThrownIncorrectlyMaiden: number;
};
