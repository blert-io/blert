'use server';

import { ChallengeMode } from '@blert/common';
import postgres from 'postgres';

import { sql } from './db';
import { Comparator, comparatorToSql, where } from './query';

export type BloatHandsQuery = {
  mode?: ChallengeMode[];
  startTime?: Comparator<Date>;
  intraChunkOrder?: number;
};

export type BloatHandsResponse = {
  totalChallenges: number;
  totalHands: number;
  byTile: Record<string, number>;
};

/**
 * Aggregates bloat hand spawn counts from filtered by mode and date range.
 *
 * @param query Conditions by which to filter the data.
 * @returns Counts of bloat hands by tile.
 */
export async function aggregateBloatHands(
  query: BloatHandsQuery,
): Promise<BloatHandsResponse> {
  const mv = sql('mv_bloat_hands_daily');
  const conditions: postgres.Fragment[] = [];

  if (query.mode !== undefined) {
    conditions.push(sql`${mv}.mode = ANY(${query.mode})`);
  }

  if (query.startTime !== undefined) {
    conditions.push(comparatorToSql(mv, 'day', query.startTime));
  }

  const totalsConditions = [sql`${mv}.tile_id IS NULL`, ...conditions];
  const tileConditions = [sql`${mv}.tile_id IS NOT NULL`, ...conditions];

  if (query.intraChunkOrder !== undefined) {
    tileConditions.push(
      sql`${mv}.intra_chunk_order = ${query.intraChunkOrder}`,
    );
  }

  const [totals, rows] = await Promise.all([
    sql<{ total_challenges: number; total_hands: number }[]>`
      SELECT
        COALESCE(SUM(challenge_count), 0)::int AS total_challenges,
        COALESCE(SUM(hand_count), 0)::int AS total_hands
      FROM mv_bloat_hands_daily
      ${where(totalsConditions)}
    `,
    sql<{ tile_id: number; hand_count: number }[]>`
      SELECT
        tile_id,
        SUM(hand_count)::int AS hand_count
      FROM ${mv}
      ${where(tileConditions)}
      GROUP BY tile_id
      ORDER BY tile_id
    `,
  ]);

  return {
    totalChallenges: totals[0].total_challenges,
    totalHands: totals[0].total_hands,
    byTile: Object.fromEntries(
      rows.map((row) => [row.tile_id.toString(), row.hand_count]),
    ),
  };
}
