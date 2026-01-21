import { SplitType, allSplitModes } from '@blert/common';

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
  { split: SplitType.TOB_MAIDEN, tier: RecordTier.POST_TIES },
  { split: SplitType.TOB_BLOAT, tier: RecordTier.POST_TIES },
  { split: SplitType.TOB_NYLO_ROOM, tier: RecordTier.POST_TIES },
  { split: SplitType.TOB_SOTETSEG, tier: RecordTier.POST_TIES },
  { split: SplitType.TOB_XARPUS, tier: RecordTier.POST_TIES },
  { split: SplitType.TOB_VERZIK_ROOM, tier: RecordTier.POST_TIES },

  // Theatre of Blood misc
  { split: SplitType.TOB_NYLO_BOSS_SPAWN, tier: RecordTier.NEW_RECORDS_ONLY },

  // Colosseum
  { split: SplitType.COLOSSEUM_CHALLENGE, tier: RecordTier.POST_TIES },
  { split: SplitType.COLOSSEUM_OVERALL, tier: RecordTier.POST_TIES },

  // Colosseum misc
  { split: SplitType.COLOSSEUM_WAVE_1, tier: RecordTier.NEW_RECORDS_ONLY },

  // Inferno
  { split: SplitType.INFERNO_CHALLENGE, tier: RecordTier.POST_TIES },
  { split: SplitType.INFERNO_OVERALL, tier: RecordTier.POST_TIES },

  // Mokhaiotl
  { split: SplitType.MOKHAIOTL_CHALLENGE, tier: RecordTier.POST_TIES },
  { split: SplitType.MOKHAIOTL_OVERALL, tier: RecordTier.POST_TIES },
];

/**
 * Returns the tier for a split type, or undefined if the split is not tracked.
 */
export function getSplitTier(splitType: SplitType): RecordTier | undefined {
  return splitTierMap.get(splitType);
}

/**
 * Returns all tracked split types (expanded to include all modes).
 */
export function getTrackedSplits(): SplitType[] {
  return Array.from(splitTierMap.keys());
}

/**
 * Returns whether ties should be announced for the given split.
 */
export function shouldPostTies(splitType: SplitType): boolean {
  const tier = splitTierMap.get(splitType);
  return tier === RecordTier.POST_TIES;
}

// Build a map of split type -> tier, expanding generic splits to all modes.
const splitTierMap = new Map<SplitType, RecordTier>();

for (const config of TRACKED_SPLITS) {
  for (const mode of allSplitModes(config.split)) {
    splitTierMap.set(mode, config.tier);
  }
}
