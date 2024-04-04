import { Types } from 'mongoose';
import { ChallengeMode } from './raid-definitions';

export enum PersonalBestType {
  // Theatre of Blood records.
  // All distinct ToB records must have consecutive integer values, in the order
  // [entry mode, regular, hard mode] to allow for easy indexing on mode.
  TOB_ENTRY_CHALLENGE = 0,
  TOB_REG_CHALLENGE = 1,
  TOB_HM_CHALLENGE = 2,
  TOB_CHALLENGE = TOB_ENTRY_CHALLENGE,

  TOB_ENTRY_OVERALL = 3,
  TOB_REG_OVERALL = 4,
  TOB_HM_OVERALL = 5,
  TOB_OVERALL = TOB_ENTRY_OVERALL,

  TOB_ENTRY_MAIDEN = 6,
  TOB_REG_MAIDEN = 7,
  TOB_HM_MAIDEN = 8,
  TOB_MAIDEN = TOB_ENTRY_MAIDEN,

  TOB_ENTRY_BLOAT = 9,
  TOB_REG_BLOAT = 10,
  TOB_HM_BLOAT = 11,
  TOB_BLOAT = TOB_ENTRY_BLOAT,

  TOB_ENTRY_NYLO_ROOM = 12,
  TOB_REG_NYLO_ROOM = 13,
  TOB_HM_NYLO_ROOM = 14,
  TOB_NYLO_ROOM = TOB_ENTRY_NYLO_ROOM,

  TOB_ENTRY_NYLO_WAVES = 15,
  TOB_REG_NYLO_WAVES = 16,
  TOB_HM_NYLO_WAVES = 17,
  TOB_NYLO_WAVES = TOB_ENTRY_NYLO_WAVES,

  TOB_ENTRY_NYLO_BOSS = 18,
  TOB_REG_NYLO_BOSS = 19,
  TOB_HM_NYLO_BOSS = 20,
  TOB_NYLO_BOSS = TOB_ENTRY_NYLO_BOSS,

  TOB_ENTRY_SOTETSEG = 21,
  TOB_REG_SOTETSEG = 22,
  TOB_HM_SOTETSEG = 23,
  TOB_SOTETSEG = TOB_ENTRY_SOTETSEG,

  TOB_ENTRY_XARPUS = 24,
  TOB_REG_XARPUS = 25,
  TOB_HM_XARPUS = 26,
  TOB_XARPUS = TOB_ENTRY_XARPUS,

  TOB_ENTRY_VERZIK_ROOM = 27,
  TOB_REG_VERZIK_ROOM = 28,
  TOB_HM_VERZIK_ROOM = 29,
  TOB_VERZIK_ROOM = TOB_ENTRY_VERZIK_ROOM,

  TOB_ENTRY_VERZIK_P1 = 30,
  TOB_REG_VERZIK_P1 = 31,
  TOB_HM_VERZIK_P1 = 32,
  TOB_VERZIK_P1 = TOB_ENTRY_VERZIK_P1,

  TOB_ENTRY_VERZIK_P2 = 33,
  TOB_REG_VERZIK_P2 = 34,
  TOB_HM_VERZIK_P2 = 35,
  TOB_VERZIK_P2 = TOB_ENTRY_VERZIK_P2,

  TOB_ENTRY_VERZIK_P3 = 36,
  TOB_REG_VERZIK_P3 = 37,
  TOB_HM_VERZIK_P3 = 38,
  TOB_VERZIK_P3 = TOB_ENTRY_VERZIK_P3,

  COLOSSEUM_CHALLENGE = 100,
  COLOSSEUM_OVERALL = 101,
  COLOSSEUM_WAVE_1 = 102,
  COLOSSEUM_WAVE_2 = 103,
  COLOSSEUM_WAVE_3 = 104,
  COLOSSEUM_WAVE_4 = 105,
  COLOSSEUM_WAVE_5 = 106,
  COLOSSEUM_WAVE_6 = 107,
  COLOSSEUM_WAVE_7 = 108,
  COLOSSEUM_WAVE_8 = 109,
  COLOSSEUM_WAVE_9 = 110,
  COLOSSEUM_WAVE_10 = 111,
  COLOSSEUM_WAVE_11 = 112,
  COLOSSEUM_WAVE_12 = 113,
}

const genericTobPbTypes = [
  PersonalBestType.TOB_CHALLENGE,
  PersonalBestType.TOB_OVERALL,
  PersonalBestType.TOB_MAIDEN,
  PersonalBestType.TOB_BLOAT,
  PersonalBestType.TOB_NYLO_ROOM,
  PersonalBestType.TOB_NYLO_WAVES,
  PersonalBestType.TOB_NYLO_BOSS,
  PersonalBestType.TOB_SOTETSEG,
  PersonalBestType.TOB_XARPUS,
  PersonalBestType.TOB_VERZIK_ROOM,
  PersonalBestType.TOB_VERZIK_P1,
  PersonalBestType.TOB_VERZIK_P2,
  PersonalBestType.TOB_VERZIK_P3,
];

/**
 * Return the mode-specific version of a generic ToB personal best type.
 *
 * This must **only** be called with a generic ToB personal best type, e.g.
 * `TOB_NYLO_WAVES`, and not with a mode-specific type like e.g.
 * `TOB_REG_NYLO_WAVES`.
 *
 * @param genericTobPb The generic ToB personal best type.
 * @param mode Raid mode.
 * @returns Personal best type for the raid mode.
 */
export function tobPbForMode(
  genericTobPb: PersonalBestType,
  mode: ChallengeMode,
): PersonalBestType {
  if (process.env.NODE_ENV !== 'production') {
    if (!genericTobPbTypes.includes(genericTobPb)) {
      throw new Error(
        `Invalid generic ToB personal best type: ${genericTobPb}`,
      );
    }
  }

  const offset =
    mode === ChallengeMode.TOB_ENTRY
      ? 0
      : mode === ChallengeMode.TOB_REGULAR
        ? 1
        : 2;
  return genericTobPb + offset;
}

export type PersonalBest = {
  type: PersonalBestType;
  playerId: Types.ObjectId;
  cId: string;
  scale: number;
  time: number;
};
