import { DistributionBin } from './types';
import { cdf } from './probability';

export type RoomAllocation = {
  key: string;
  ticks: number;
};

/**
 * Optimizes the allocation of a tick budget across rooms to maximize the
 * product of per-room CDFs.
 *
 * @param rooms Rooms with their tick distribution data.
 * @param budget Total tick budget to distribute.
 */
export function optimizeAllocation(
  rooms: { key: string; bins: DistributionBin[]; total: number }[],
  budget: number,
): RoomAllocation[] | null {
  const n = rooms.length;

  if (n === 0 || budget <= 0) {
    return null;
  }

  if (n === 1) {
    if (cdf(rooms[0].bins, rooms[0].total, budget) === 0) {
      return null;
    }
    return [{ key: rooms[0].key, ticks: budget }];
  }

  // Uses dynamic programming with CDF breakpoints to efficiently find balanced
  // room targets.
  // DP: dp[j] = max product of CDFs for rooms processed so far with budget j.

  // Extract CDF breakpoints for each room and precompute the CDF at each
  // breakpoint.
  const breakpoints: number[][] = rooms.map((r) => {
    const bps = [0];
    for (const bin of r.bins) {
      if (bin.ticks > 0 && bin.ticks <= budget) {
        bps.push(bin.ticks);
      }
    }
    return bps;
  });

  const cdfAt: number[][] = rooms.map((r, i) =>
    breakpoints[i].map((t) => cdf(r.bins, r.total, t)),
  );

  let dp = new Float64Array(budget + 1);

  {
    let bpIdx = 0;
    for (let j = 0; j <= budget; j++) {
      while (
        bpIdx + 1 < breakpoints[0].length &&
        breakpoints[0][bpIdx + 1] <= j
      ) {
        bpIdx++;
      }
      dp[j] = cdfAt[0][bpIdx];
    }
  }

  const traces: Int32Array[] = [];

  for (let i = 1; i < n; i++) {
    const newDp = new Float64Array(budget + 1);
    const trace = new Int32Array(budget + 1);
    const bps = breakpoints[i];
    const cdfs = cdfAt[i];

    for (let j = 0; j <= budget; j++) {
      let best = -1;
      let bestTicks = 0;

      for (let k = 0; k < bps.length; k++) {
        if (bps[k] > j) {
          break;
        }
        const val = dp[j - bps[k]] * cdfs[k];
        if (val > best) {
          best = val;
          bestTicks = bps[k];
        }
      }

      newDp[j] = best;
      trace[j] = bestTicks;
    }

    dp = newDp;
    traces.push(trace);
  }

  if (dp[budget] === 0) {
    return null;
  }

  // Backtrack to find per-room allocations.
  const ticks = new Array<number>(n);
  let remaining = budget;

  for (let i = n - 1; i >= 1; i--) {
    ticks[i] = traces[i - 1][remaining];
    remaining -= ticks[i];
  }
  // Room 0 absorbs all remaining budget.
  ticks[0] = remaining;

  return rooms.map((r, i) => ({ key: r.key, ticks: ticks[i] }));
}
