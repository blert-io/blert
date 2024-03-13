export type TobPbs = {
  regSolo: number | null;
  regDuo: number | null;
  regTrio: number | null;
  regFours: number | null;
  regFives: number | null;
  hmtSolo: number | null;
  hmtDuo: number | null;
  hmtTrio: number | null;
  hmtFours: number | null;
  hmtFives: number | null;
};

export type Player = {
  username: string;
  formattedUsername: string;
  totalRaidsRecorded: number;
  personalBests: {
    theatreOfBlood: TobPbs;
  };
};

export type PlayerStats = {
  username: string;
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
