'use server';

import { SplitType } from '@blert/common';

import { sql } from './db';

type DistributionRow = {
  type: number;
  ticks: number;
  count: number;
};

export type DistributionBin = {
  ticks: number;
  count: number;
};

export type SplitDistribution = {
  splitType: number;
  bins: DistributionBin[];
  total: number;
};

export type SplitTier = 'standard' | 'speedrun';

/**
 * Fetches split distribution data from the `split_distributions` materialized
 * view, grouped by split type.
 *
 * @param types The mode-specific split types to fetch.
 * @param scale The challenge scale.
 * @param tier Optional tier filter.
 * @returns Distribution data for each requested type that has data.
 */
export async function getSplitDistributions(
  types: SplitType[],
  scale: number,
  tier?: SplitTier,
): Promise<SplitDistribution[]> {
  const rows = await sql<DistributionRow[]>`
    SELECT type, ticks, SUM(count)::int AS count
    FROM split_distributions
    WHERE type = ANY(${types})
      AND scale = ${scale}
      ${tier ? sql`AND tier = ${tier}` : sql``}
    GROUP BY type, ticks
    ORDER BY type, ticks
  `;

  const byType = new Map<number, DistributionBin[]>();
  const totals = new Map<number, number>();

  for (const row of rows) {
    if (!byType.has(row.type)) {
      byType.set(row.type, []);
      totals.set(row.type, 0);
    }
    byType.get(row.type)!.push({ ticks: row.ticks, count: row.count });
    totals.set(row.type, totals.get(row.type)! + row.count);
  }

  return types
    .filter((t) => byType.has(t))
    .map((t) => ({
      splitType: t,
      bins: byType.get(t)!,
      total: totals.get(t)!,
    }));
}
