import { Types } from 'mongoose';

export type Player = {
  _id: Types.ObjectId;
  username: string;
  formattedUsername: string;
  totalRaidsRecorded: number;
  overallExperience: number;
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

const OSRS_HISCORES_API =
  'https://secure.runescape.com/m=hiscore_oldschool/index_lite.ws';

/**
 * Looks up a player's overall experience on the OSRS hiscores.
 *
 * @param username OSRS username of the account.
 * @returns The overall experience of the account, or null if the account does
 *     not exist.
 */
export async function hiscoreLookup(username: string): Promise<number | null> {
  const response = await fetch(`${OSRS_HISCORES_API}?player=${username}`);
  if (response.status === 404) {
    return null;
  }

  if (response.status === 503) {
    throw new HiscoresRateLimitError();
  }

  const text = await response.text().then((t) => t.split('\n'));
  const overall = text[0].split(',');
  const overallExp = parseInt(overall[2]);
  return overallExp;
}

export class HiscoresRateLimitError extends Error {
  constructor() {
    super('OSRS Hiscores API access throttled');
  }
}
