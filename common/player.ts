export type Player = {
  username: string;
  totalRaidsRecorded: number;
};

export type PlayerStats = {
  username: string;
  date: Date;

  completions: number;
  wipes: number;
  resets: number;
  deaths: number;

  bgsSmacks: number;
  hammerBops: number;
  barragesWithoutProperWeapon: number;

  chinsThrown: number;
  chinsThrownValue: number;
  chinsThrownWrongDistance: number;
};
