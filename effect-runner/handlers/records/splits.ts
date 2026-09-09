import { SplitType, Stage, allSplitModes, splitToStage } from '@blert/common';

export const enum RecordTier {
  /**
   * Tier 1: Significant splits where tying a record is noteworthy.
   * Both new records and ties are announced.
   */
  POST_TIES = 1,

  /**
   * Tier 2: Less significant splits where ties are common.
   * Only new records are announced, ties are not.
   */
  NEW_RECORDS_ONLY = 2,
}

type SplitConfig = {
  /** The generic split type. */
  split: SplitType;
  /** How to handle ties for this split. */
  tier: RecordTier;
};

/**
 * Splits that should be tracked for records, along with their tier.
 */
const TRACKED_SPLITS: SplitConfig[] = [
  // Theatre of Blood
  { split: SplitType.TOB_CHALLENGE, tier: RecordTier.POST_TIES },
  { split: SplitType.TOB_OVERALL, tier: RecordTier.POST_TIES },

  // Theatre of Blood rooms
  { split: SplitType.TOB_MAIDEN, tier: RecordTier.NEW_RECORDS_ONLY },
  { split: SplitType.TOB_BLOAT, tier: RecordTier.NEW_RECORDS_ONLY },
  { split: SplitType.TOB_NYLO_ROOM, tier: RecordTier.NEW_RECORDS_ONLY },
  { split: SplitType.TOB_SOTETSEG, tier: RecordTier.NEW_RECORDS_ONLY },
  { split: SplitType.TOB_XARPUS, tier: RecordTier.NEW_RECORDS_ONLY },
  { split: SplitType.TOB_VERZIK_ROOM, tier: RecordTier.NEW_RECORDS_ONLY },

  // Theatre of Blood misc
  { split: SplitType.TOB_NYLO_BOSS_SPAWN, tier: RecordTier.NEW_RECORDS_ONLY },

  // Colosseum
  { split: SplitType.COLOSSEUM_CHALLENGE, tier: RecordTier.POST_TIES },
  { split: SplitType.COLOSSEUM_OVERALL, tier: RecordTier.POST_TIES },

  // Colosseum misc
  { split: SplitType.COLOSSEUM_WAVE_1, tier: RecordTier.NEW_RECORDS_ONLY },

  // Inferno
  { split: SplitType.INFERNO_CHALLENGE, tier: RecordTier.POST_TIES },

  // Mokhaiotl
  { split: SplitType.MOKHAIOTL_CHALLENGE, tier: RecordTier.POST_TIES },
  { split: SplitType.MOKHAIOTL_OVERALL, tier: RecordTier.POST_TIES },
];

/**
 * Returns whether ties should be announced for the given split.
 */
export function shouldPostTies(splitType: SplitType): boolean {
  const tier = splitTierMap.get(splitType);
  return tier === RecordTier.POST_TIES;
}

/**
 * Returns the tracked splits recorded when the given stage finishes.
 * @param stage The finished stage.
 * @returns Mode-specific split types belonging to the stage, possibly empty.
 */
export function trackedStageSplits(stage: Stage): readonly SplitType[] {
  return stageSplits.get(stage) ?? [];
}

/**
 * Returns the tracked splits recorded when a challenge finishes.
 * @returns Mode-specific split types spanning a whole challenge.
 */
export function trackedChallengeSplits(): readonly SplitType[] {
  return challengeSplits;
}

// Expand the generic tracked splits to every mode with each one's tier and
// whether it is written at the end of a stage or of the challenge.
const splitTierMap = new Map<SplitType, RecordTier>();
const stageSplits = new Map<Stage, SplitType[]>();
const challengeSplits: SplitType[] = [];

for (const config of TRACKED_SPLITS) {
  for (const mode of allSplitModes(config.split)) {
    splitTierMap.set(mode, config.tier);

    const stage = splitToStage(mode);
    if (stage === Stage.UNKNOWN) {
      challengeSplits.push(mode);
    } else {
      const splits = stageSplits.get(stage) ?? [];
      splits.push(mode);
      stageSplits.set(stage, splits);
    }
  }
}
