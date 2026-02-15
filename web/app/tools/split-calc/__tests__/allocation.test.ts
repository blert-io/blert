import { optimizeAllocation } from '../allocation';
import { DistributionBin } from '../types';

function makeBins(entries: [number, number][]): DistributionBin[] {
  return entries.map(([ticks, count]) => ({ ticks, count }));
}

function totalFrom(bins: DistributionBin[]): number {
  return bins.reduce((sum, b) => sum + b.count, 0);
}

describe('optimizeAllocation', () => {
  describe('edge cases', () => {
    it('returns null for empty rooms', () => {
      expect(optimizeAllocation([], 100)).toBeNull();
    });

    it('returns null for zero budget', () => {
      const bins = makeBins([[10, 5]]);
      expect(optimizeAllocation([{ key: 'a', bins, total: 5 }], 0)).toBeNull();
    });

    it('returns null for negative budget', () => {
      const bins = makeBins([[10, 5]]);
      expect(
        optimizeAllocation([{ key: 'a', bins, total: 5 }], -10),
      ).toBeNull();
    });
  });

  describe('single room', () => {
    it('assigns full budget to the single room', () => {
      const bins = makeBins([
        [5, 2],
        [10, 3],
        [15, 5],
      ]);
      const total = totalFrom(bins);
      const result = optimizeAllocation([{ key: 'maiden', bins, total }], 20);

      expect(result).not.toBeNull();
      expect(result).toHaveLength(1);
      expect(result![0]).toEqual({ key: 'maiden', ticks: 20 });
    });

    it('returns null when budget is below all bin ticks', () => {
      const bins = makeBins([
        [10, 3],
        [20, 7],
      ]);
      const total = totalFrom(bins);
      // Budget of 5 is below the minimum bin tick (10), so CDF(5) = 0.
      expect(
        optimizeAllocation([{ key: 'maiden', bins, total }], 5),
      ).toBeNull();
    });
  });

  describe('two rooms', () => {
    it('splits budget to maximize product of CDFs', () => {
      // Room A: equally likely 10 or 20 ticks.
      const binsA = makeBins([
        [10, 1],
        [20, 1],
      ]);
      // Room B: equally likely 5 or 15 ticks.
      const binsB = makeBins([
        [5, 1],
        [15, 1],
      ]);

      const result = optimizeAllocation(
        [
          { key: 'a', bins: binsA, total: 2 },
          { key: 'b', bins: binsB, total: 2 },
        ],
        25,
      );

      expect(result).not.toBeNull();
      expect(result).toHaveLength(2);

      // Ticks must sum to budget.
      const totalTicks = result!.reduce((s, r) => s + r.ticks, 0);
      expect(totalTicks).toBe(25);

      // With budget 25:
      //   Option: A=10, B=15 -> CDF_A(10)=0.5, CDF_B(15)=1.0, product=0.5
      //   Option: A=20, B=5  -> CDF_A(20)=1.0, CDF_B(5)=0.5, product=0.5
      // Both are optimal. The optimizer should pick one of them.
      const allocA = result!.find((r) => r.key === 'a')!;
      const allocB = result!.find((r) => r.key === 'b')!;
      expect(
        (allocA.ticks >= 10 && allocB.ticks >= 5) ||
          (allocA.ticks >= 20 && allocB.ticks >= 15),
      ).toBe(true);
    });

    it('returns null when budget is infeasible', () => {
      // Both rooms need at least 10 ticks for nonzero CDF.
      const bins = makeBins([
        [10, 1],
        [20, 1],
      ]);
      const result = optimizeAllocation(
        [
          { key: 'a', bins, total: 2 },
          { key: 'b', bins, total: 2 },
        ],
        15, // Not enough for both rooms to reach their minimum.
      );
      expect(result).toBeNull();
    });
  });

  describe('three rooms', () => {
    it('distributes budget across three rooms', () => {
      const bins = makeBins([
        [10, 3],
        [20, 4],
        [30, 3],
      ]);
      const total = totalFrom(bins);
      const rooms = [
        { key: 'a', bins, total },
        { key: 'b', bins, total },
        { key: 'c', bins, total },
      ];

      const result = optimizeAllocation(rooms, 60);

      expect(result).not.toBeNull();
      expect(result).toHaveLength(3);

      // Allocations must sum to budget.
      const totalTicks = result!.reduce((s, r) => s + r.ticks, 0);
      expect(totalTicks).toBe(60);

      // Each room should get at least the minimum (10).
      for (const alloc of result!) {
        expect(alloc.ticks).toBeGreaterThanOrEqual(10);
      }
    });

    it('gives balanced allocation for identical rooms', () => {
      // Three identical rooms, uniform over {10, 20, 30}.
      const bins = makeBins([
        [10, 1],
        [20, 1],
        [30, 1],
      ]);
      const total = 3;
      const rooms = [
        { key: 'a', bins, total },
        { key: 'b', bins, total },
        { key: 'c', bins, total },
      ];

      // Budget = 60 means each room can get 20.
      // CDF(20) = 2/3 for each, product = (2/3)^3 ≈ 0.296
      // Any rebalancing would reduce the product since CDF is concave.
      const result = optimizeAllocation(rooms, 60);

      expect(result).not.toBeNull();

      // With identical rooms and balanced budget, allocations should be equal.
      // The DP operates on breakpoints so each room should get exactly 20.
      for (const alloc of result!) {
        expect(alloc.ticks).toBe(20);
      }
    });
  });

  describe('optimality', () => {
    it('prefers balanced allocation over skewed', () => {
      // Room A: CDF jumps at 10 (50%) and 30 (100%).
      const binsA = makeBins([
        [10, 1],
        [30, 1],
      ]);
      // Room B: CDF jumps at 10 (50%) and 30 (100%).
      const binsB = makeBins([
        [10, 1],
        [30, 1],
      ]);

      const result = optimizeAllocation(
        [
          { key: 'a', bins: binsA, total: 2 },
          { key: 'b', bins: binsB, total: 2 },
        ],
        40,
      );

      expect(result).not.toBeNull();

      // Budget 40, two options:
      //   Balanced: A=10, B=30 -> 0.5 * 1.0 = 0.5
      //             A=30, B=10 -> 1.0 * 0.5 = 0.5
      //   Both give product 0.5. No way to get higher.
      //   A=20, B=20 -> 0.5 * 0.5 = 0.25 (worse)
      const allocA = result!.find((r) => r.key === 'a')!;
      const allocB = result!.find((r) => r.key === 'b')!;

      // One room should get 30 (100% CDF) and the other 10 (50% CDF).
      const ticks = [allocA.ticks, allocB.ticks].sort((a, b) => a - b);
      expect(ticks).toEqual([10, 30]);
    });

    it('allocates more to room with higher marginal CDF gain', () => {
      // Room A: most mass at low ticks (easy room).
      const binsA = makeBins([
        [5, 8],
        [10, 2],
      ]);
      // Room B: most mass at high ticks (hard room).
      const binsB = makeBins([
        [20, 2],
        [40, 8],
      ]);

      const result = optimizeAllocation(
        [
          { key: 'a', bins: binsA, total: 10 },
          { key: 'b', bins: binsB, total: 10 },
        ],
        45,
      );

      expect(result).not.toBeNull();

      const allocA = result!.find((r) => r.key === 'a')!;
      const allocB = result!.find((r) => r.key === 'b')!;

      // Room A saturates at 10 ticks (CDF=1.0), so extra budget should go to B.
      // Optimal: A=5, B=40 -> CDF_A(5)=0.8, CDF_B(40)=1.0, product=0.8
      // vs A=10, B=35 -> CDF_A(10)=1.0, CDF_B(35)=0.2, product=0.2
      // vs A=5, B=40 is better.
      expect(allocB.ticks).toBeGreaterThanOrEqual(allocA.ticks);
    });
  });

  describe('key preservation', () => {
    it('preserves room keys in output', () => {
      const bins = makeBins([
        [10, 1],
        [20, 1],
      ]);
      const result = optimizeAllocation(
        [
          { key: 'maiden', bins, total: 2 },
          { key: 'bloat', bins, total: 2 },
          { key: 'nylo', bins, total: 2 },
        ],
        60,
      );

      expect(result).not.toBeNull();
      const keys = result!.map((r) => r.key);
      expect(keys).toEqual(['maiden', 'bloat', 'nylo']);
    });
  });
});
