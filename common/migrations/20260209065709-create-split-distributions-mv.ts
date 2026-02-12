import { Sql } from 'postgres';

import { ChallengeType } from '../challenge';
import { SplitType } from '../split';

// 1-down bloat threshold in ticks.
const SPEEDRUN_BLOAT_THRESHOLD = 100;

export async function migrate(sql: Sql) {
  await sql`
    CREATE TYPE split_tier AS ENUM ('standard', 'speedrun')
  `;

  // Use sql.unsafe() because CREATE MATERIALIZED VIEW does not support
  // bound parameters.
  await sql.unsafe(`
    CREATE MATERIALIZED VIEW split_distributions AS
    WITH challenge_quality AS (
      SELECT c.id,
        CASE
          WHEN c.type = ${ChallengeType.TOB} AND c.scale >= 3 AND EXISTS (
            SELECT 1 FROM challenge_splits bloat
            WHERE bloat.challenge_id = c.id
              AND bloat.type IN (${SplitType.TOB_REG_BLOAT}, ${SplitType.TOB_HM_BLOAT})
              AND bloat.ticks < ${SPEEDRUN_BLOAT_THRESHOLD}
              AND bloat.accurate
          ) THEN 'speedrun'::split_tier
          ELSE 'standard'::split_tier
        END AS tier
      FROM challenges c
      WHERE c.start_time >= NOW() - INTERVAL '6 months'
    ),
    cutoffs AS (
      SELECT cs.type, cs.scale, cq.tier,
        PERCENTILE_DISC(0.9) WITHIN GROUP (ORDER BY cs.ticks) AS cutoff_ticks
      FROM challenge_splits cs
      JOIN challenge_quality cq ON cq.id = cs.challenge_id
      WHERE cs.accurate
      GROUP BY cs.type, cs.scale, cq.tier
    )
    SELECT cs.type, cs.scale, cq.tier, cs.ticks, COUNT(*)::int AS count
    FROM challenge_splits cs
    JOIN challenge_quality cq ON cq.id = cs.challenge_id
    LEFT JOIN cutoffs co
      ON co.type = cs.type AND co.scale = cs.scale AND co.tier = cq.tier
    WHERE cs.accurate
      AND (
        cq.tier != 'standard'
        OR cs.ticks <= co.cutoff_ticks
      )
    GROUP BY cs.type, cs.scale, cq.tier, cs.ticks
    WITH DATA
  `);

  await sql`
    CREATE UNIQUE INDEX uix_split_distributions_pkey
      ON split_distributions (type, scale, tier, ticks)
  `;
}
