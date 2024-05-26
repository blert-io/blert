import { Types } from 'mongoose';

import { Skill } from './raid-definitions';

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

export type PlayerExperience = Record<Skill, number>;

/**
 * Looks up a player's overall experience on the OSRS hiscores.
 *
 * @param username OSRS username of the account.
 * @returns The overall experience of the account, or null if the account does
 *     not exist.
 */
export async function hiscoreLookup(
  username: string,
): Promise<PlayerExperience | null> {
  const response = await fetch(`${OSRS_HISCORES_API}?player=${username}`);
  if (response.status === 404) {
    return null;
  }

  if (response.status === 503) {
    throw new HiscoresRateLimitError();
  }

  const text = await response.text().then((t) => t.split('\n'));
  const overall = text[0].split(',');
  const attack = text[1].split(',');
  const defence = text[2].split(',');
  const strength = text[3].split(',');
  const hitpoints = text[4].split(',');
  const ranged = text[5].split(',');
  const prayer = text[6].split(',');
  const magic = text[7].split(',');

  return {
    [Skill.OVERALL]: parseInt(overall[2]),
    [Skill.ATTACK]: parseInt(attack[2]),
    [Skill.DEFENCE]: parseInt(defence[2]),
    [Skill.STRENGTH]: parseInt(strength[2]),
    [Skill.HITPOINTS]: parseInt(hitpoints[2]),
    [Skill.RANGED]: parseInt(ranged[2]),
    [Skill.PRAYER]: parseInt(prayer[2]),
    [Skill.MAGIC]: parseInt(magic[2]),
  };
}

export class HiscoresRateLimitError extends Error {
  constructor() {
    super('OSRS Hiscores API access throttled');
  }
}
