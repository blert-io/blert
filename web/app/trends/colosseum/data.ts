import { SplitType, splitName } from '@blert/common';

import { PercentileCategory, PlayerMark } from '@/components/percentile-chart';
import { distributionStats, percentile } from '@/utils/probability';

export type WavePercentiles = {
  splitType: SplitType;
  count: number;
  percentiles: Record<number, number>;
};

export type Distribution = {
  splitType: SplitType;
  bins: { ticks: number; count: number }[];
  total: number;
};

export const COLOSSEUM_WAVE_SPLITS: SplitType[] = Array.from(
  { length: 12 },
  (_, i) => SplitType.COLOSSEUM_WAVE_1 + i,
);

const SOL_HEREDIT_WAVE = 12;

function waveNumber(splitType: SplitType): number {
  return splitType - SplitType.COLOSSEUM_WAVE_1 + 1;
}

/**
 * Transforms Colosseum wave percentiles from the splits percentiles API into
 * categories for a {@link PercentileChart}.
 * The data must include the percentiles (5, 25, 50, 75, 95).
 */
export function wavesToCategories(
  data: WavePercentiles[],
): PercentileCategory[] {
  return data
    .filter(
      (d) =>
        d.splitType >= SplitType.COLOSSEUM_WAVE_1 &&
        d.splitType <= SplitType.COLOSSEUM_WAVE_12,
    )
    .sort((a, b) => a.splitType - b.splitType)
    .map((d) => {
      const wave = waveNumber(d.splitType);
      return {
        key: d.splitType,
        label: wave === SOL_HEREDIT_WAVE ? 'Sol' : wave.toString(),
        name: splitName(d.splitType),
        count: d.count,
        stats: {
          p5: d.percentiles[5],
          p25: d.percentiles[25],
          p50: d.percentiles[50],
          p75: d.percentiles[75],
          p95: d.percentiles[95],
        },
      };
    });
}

/**
 * Returns the date six months before `from`, truncated to UTC midnight so
 * repeated requests share a cacheable URL, clamping to the target month's
 * final day.
 */
export function sixMonthsAgo(from: Date = new Date()): Date {
  const date = new Date(from);
  date.setUTCHours(0, 0, 0, 0);

  const targetMonth = (date.getUTCMonth() + 6) % 12;
  date.setUTCMonth(date.getUTCMonth() - 6);
  if (date.getUTCMonth() !== targetMonth) {
    date.setUTCDate(0);
  }
  return date;
}

/**
 * Builds per-wave player marks from a player's split distributions.
 *
 * When global distributions are provided, each mark includes the player's
 * percentile within them. The global bins are trimmed above the 90th
 * percentile, so the percentile is taken over the wave's full sample count.
 * A percentile is omitted if the player's median lies beyond the global
 * distribution's upper bound, or if the global distribution or sample count
 * is missing.
 */
export function playerWaveMarks(
  playerDistributions: Distribution[],
  globalDistributions: Distribution[] | null,
  sampleCounts: Map<number, number>,
): Map<number, PlayerMark> {
  const globalByType = new Map(
    (globalDistributions ?? []).map((d) => [d.splitType, d]),
  );

  const marks = new Map<number, PlayerMark>();
  for (const dist of playerDistributions) {
    const median = distributionStats(dist.bins, dist.total)?.median ?? null;
    if (median === null) {
      continue;
    }

    const mark: PlayerMark = { median, count: dist.total };
    const global = globalByType.get(dist.splitType);
    const sampleCount = sampleCounts.get(dist.splitType);
    if (
      global !== undefined &&
      sampleCount !== undefined &&
      sampleCount > 0 &&
      global.bins.length > 0 &&
      median <= global.bins[global.bins.length - 1].ticks
    ) {
      mark.percentile = percentile(global.bins, sampleCount, median);
    }
    marks.set(dist.splitType, mark);
  }
  return marks;
}

/** Adds player marks onto percentile categories. */
export function attachPlayerMarks(
  categories: PercentileCategory[],
  marks: Map<number, PlayerMark>,
): PercentileCategory[] {
  return categories.map((c) => {
    const player = marks.get(c.key as number);
    return player === undefined ? c : { ...c, player };
  });
}
