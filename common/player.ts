import { Skill } from './challenge';

export type Player = {
  username: string;
  totalRecordings: number;
  overallExperience: number;
  attackExperience: number;
  defenceExperience: number;
  strengthExperience: number;
  hitpointsExperience: number;
  rangedExperience: number;
  prayerExperience: number;
  magicExperience: number;
};

export type PlayerStats = {
  playerId: number;
  date: Date;

  tobCompletions: number;
  tobWipes: number;
  tobResets: number;

  colosseumCompletions: number;
  colosseumWipes: number;
  colosseumResets: number;

  mokhaiotlCompletions: number;
  mokhaiotlWipes: number;
  mokhaiotlResets: number;
  mokhaiotlTotalDelves: number;

  deathsTotal: number;
  deathsMaiden: number;
  deathsBloat: number;
  deathsNylocas: number;
  deathsSotetseg: number;
  deathsXarpus: number;
  deathsVerzik: number;

  bgsSmacks: number;
  hammerBops: number;
  challyPokes: number;
  unchargedScytheSwings: number;
  ralosAutos: number;
  elderMaulSmacks: number;

  tobBarragesWithoutProperWeapon: number;
  tobVerzikP1TrollSpecs: number;
  tobVerzikP3Melees: number;

  chinsThrownTotal: number;
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
