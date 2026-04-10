'use server';

import { ChallengeType, SplitType, normalizeRsn } from '@blert/common';

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

// 1-down bloat threshold in ticks (matches the MV definition).
const SPEEDRUN_BLOAT_THRESHOLD = 100;

function rowsToDistributions(
  rows: DistributionRow[],
  types: SplitType[],
): SplitDistribution[] {
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

  return rowsToDistributions(rows, types);
}

/**
 * Fetches split distributions filtered to challenges involving specific
 * players. When multiple usernames are provided, only challenges where all
 * specified players participated are included.
 *
 * @param party Players in the challenge party.
 * @param types The mode-specific split types to fetch.
 * @param scale The challenge scale.
 * @param tier Optional tier filter (speedrun/standard).
 * @param after Optional lower bound on challenge start time.
 * @param before Optional upper bound on challenge start time.
 * @returns Distribution data for each requested type that has data.
 */
export async function getFilteredSplitDistributions(
  party: string[],
  types: SplitType[],
  scale: number,
  tier?: SplitTier,
  after?: Date,
  before?: Date,
): Promise<SplitDistribution[]> {
  const normalizedParty = party.map(normalizeRsn);

  const matchingChallenges = sql`
    SELECT cp.challenge_id AS id
    FROM challenge_players cp
    JOIN players p ON p.id = cp.player_id
    WHERE p.normalized_username = ANY(${normalizedParty})
    GROUP BY cp.challenge_id
    HAVING COUNT(DISTINCT cp.player_id) = ${party.length}
  `;

  const temporalFilter = sql`
    ${after ? sql`AND c.start_time >= ${after}` : sql``}
    ${before ? sql`AND c.start_time < ${before}` : sql``}
  `;

  // When tier is requested, classify each challenge via the bloat EXISTS
  // check. When it's not, skip the classification entirely to avoid the
  // per-challenge subquery.
  let rows: DistributionRow[];

  if (tier) {
    rows = await sql<DistributionRow[]>`
      WITH matching AS (${matchingChallenges}),
      classified AS (
        SELECT m.id,
          CASE
            WHEN c.type = ${ChallengeType.TOB}
              AND c.scale >= 3
              AND EXISTS (
                SELECT 1 FROM challenge_splits bloat
                WHERE bloat.challenge_id = m.id
                  AND bloat.type IN (
                    ${SplitType.TOB_REG_BLOAT},
                    ${SplitType.TOB_HM_BLOAT}
                  )
                  AND bloat.ticks < ${SPEEDRUN_BLOAT_THRESHOLD}
                  AND bloat.accurate
              ) THEN 'speedrun'::split_tier
            ELSE 'standard'::split_tier
          END AS tier
        FROM matching m
        JOIN challenges c ON c.id = m.id
        WHERE c.scale = ${scale}
          ${temporalFilter}
      )
      SELECT cs.type, cs.ticks, COUNT(*)::int AS count
      FROM challenge_splits cs
      JOIN classified cl ON cl.id = cs.challenge_id
      WHERE cs.type = ANY(${types})
        AND cs.accurate
        AND cl.tier = ${tier}
      GROUP BY cs.type, cs.ticks
      ORDER BY cs.type, cs.ticks
    `;
  } else {
    rows = await sql<DistributionRow[]>`
      WITH matching AS (${matchingChallenges})
      SELECT cs.type, cs.ticks, COUNT(*)::int AS count
      FROM challenge_splits cs
      JOIN matching m ON m.id = cs.challenge_id
      JOIN challenges c ON c.id = cs.challenge_id
      WHERE cs.type = ANY(${types})
        AND cs.accurate
        AND c.scale = ${scale}
        ${temporalFilter}
      GROUP BY cs.type, cs.ticks
      ORDER BY cs.type, cs.ticks
    `;
  }

  return rowsToDistributions(rows, types);
}
