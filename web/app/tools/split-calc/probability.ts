import { DistributionBin } from './types';

/**
 * Computes the CDF value at tick count `ticks` within a distribution.
 *
 * @param bins The distribution bins, sorted by ascending ticks.
 * @param total The total number of times recorded in the distribution.
 * @param ticks The tick count to compute the CDF for.
 * @returns The CDF value at `ticks`.
 */
export function cdf(
  bins: DistributionBin[],
  total: number,
  ticks: number,
): number {
  if (total === 0) {
    return 0;
  }
  let cumulative = 0;
  for (const bin of bins) {
    if (bin.ticks > ticks) {
      break;
    }
    cumulative += bin.count;
  }
  return cumulative / total;
}

/**
 * Returns the percentile (0–100) for a given tick count within a distribution.
 */
export function percentile(
  bins: DistributionBin[],
  total: number,
  ticks: number,
): number {
  return cdf(bins, total, ticks) * 100;
}

/**
 * Convolves multiple discrete distributions to compute the distribution of
 * their sum. Each input distribution is an array of {ticks, count} bins with
 * an associated total.
 *
 * @param distributions Array of distribution data for each room.
 * @param maxSum Maximum tick sum to consider.
 * @returns A Float64Array where result[i] = P(sum = i ticks).
 */
export function convolveDistributions(
  distributions: { bins: DistributionBin[]; total: number }[],
  maxSum: number,
): Float64Array {
  if (distributions.length === 0) {
    const result = new Float64Array(maxSum + 1);
    result[0] = 1;
    return result;
  }

  let current = new Float64Array(maxSum + 1);

  // Initialize with first distribution and convolve with the rest.
  const first = distributions[0];
  for (const bin of first.bins) {
    if (bin.ticks <= maxSum) {
      current[bin.ticks] = bin.count / first.total;
    }
  }

  for (let d = 1; d < distributions.length; d++) {
    const next = new Float64Array(maxSum + 1);
    const dist = distributions[d];

    for (let i = 0; i <= maxSum; i++) {
      if (current[i] === 0) {
        continue;
      }
      for (const bin of dist.bins) {
        const sum = i + bin.ticks;
        if (sum > maxSum) {
          break;
        }
        next[sum] += current[i] * (bin.count / dist.total);
      }
    }

    current = next;
  }

  return current;
}

/**
 * Computes the probability that the sum of room times is at most `target`,
 * given the convolved distribution of room times.
 *
 * @param convolved The convolved distribution of room times.
 * @param target The target time.
 * @returns The probability that the sum of room times is at most `target`.
 */
export function targetProbability(
  convolved: Float64Array,
  target: number,
): number {
  let sum = 0;
  const limit = Math.min(target, convolved.length - 1);
  for (let i = 0; i <= limit; i++) {
    sum += convolved[i];
  }
  return sum;
}

/**
 * Finds the smallest tick value where the convolved CDF exceeds the given
 * threshold.
 *
 * @param convolved The convolved distribution.
 * @param threshold The probability threshold (0–1).
 * @returns The first tick where the convolved CDF meets the given threshold, or
 * `null` if the threshold is never reached.
 */
export function convolvedPercentile(
  convolved: Float64Array,
  threshold: number,
): number | null {
  let cumulative = 0;
  for (let i = 0; i < convolved.length; i++) {
    cumulative += convolved[i];
    if (cumulative >= threshold) {
      return i;
    }
  }
  return null;
}

export function formatPercentile(pct: number): string {
  const prefix = pct < 50 ? '<' : '>';
  if (pct < 0.1) {
    return '<0.1%';
  }
  if (pct > 99.9) {
    return '>99.9%';
  }
  return `${prefix}${pct.toFixed(1)}%`;
}
