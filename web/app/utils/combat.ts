export enum BoostType {
  SUPER_COMBAT,
  RANGING_POTION,
  SATURATED_HEART,
}

export function maxBoostedLevel(type: BoostType, baseLevel: number): number {
  switch (type) {
    case BoostType.SUPER_COMBAT:
      return Math.floor(baseLevel * 1.15) + 5;
    case BoostType.RANGING_POTION:
      return Math.floor(baseLevel * 1.1) + 4;
    case BoostType.SATURATED_HEART:
      return Math.floor(baseLevel * 1.1) + 4;
    default:
      return baseLevel;
  }
}
