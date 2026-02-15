import {
  cdf,
  convolveDistributions,
  convolvedPercentile,
  formatPercentile,
  percentile,
  targetProbability,
} from '../probability';
import { DistributionBin } from '../types';

describe('cdf', () => {
  const bins: DistributionBin[] = [
    { ticks: 10, count: 2 },
    { ticks: 20, count: 3 },
    { ticks: 30, count: 5 },
  ];
  const total = 10;

  it('returns 0 for ticks below minimum', () => {
    expect(cdf(bins, total, 5)).toBe(0);
  });

  it('returns cumulative fraction at exact bin tick', () => {
    expect(cdf(bins, total, 10)).toBe(0.2);
    expect(cdf(bins, total, 20)).toBe(0.5);
    expect(cdf(bins, total, 30)).toBe(1.0);
  });

  it('returns cumulative fraction between bins', () => {
    expect(cdf(bins, total, 15)).toBe(0.2);
    expect(cdf(bins, total, 25)).toBe(0.5);
  });

  it('returns 1 for ticks above maximum', () => {
    expect(cdf(bins, total, 100)).toBe(1.0);
  });

  it('returns 0 for empty distribution', () => {
    expect(cdf([], 0, 10)).toBe(0);
  });
});

describe('percentile', () => {
  it('returns cdf * 100', () => {
    const bins: DistributionBin[] = [
      { ticks: 10, count: 1 },
      { ticks: 20, count: 1 },
    ];
    expect(percentile(bins, 2, 10)).toBe(50);
    expect(percentile(bins, 2, 20)).toBe(100);
  });
});

describe('convolveDistributions', () => {
  it('returns delta at 0 for empty input', () => {
    const result = convolveDistributions([], 10);
    expect(result[0]).toBe(1);
    for (let i = 1; i <= 10; i++) {
      expect(result[i]).toBe(0);
    }
  });

  it('returns single distribution unchanged', () => {
    const bins: DistributionBin[] = [
      { ticks: 2, count: 1 },
      { ticks: 3, count: 1 },
    ];
    const result = convolveDistributions([{ bins, total: 2 }], 10);
    expect(result[2]).toBeCloseTo(0.5);
    expect(result[3]).toBeCloseTo(0.5);
    expect(result[0]).toBe(0);
    expect(result[1]).toBe(0);
  });

  it('convolves two uniform distributions correctly', () => {
    // Two rooms, each equally likely to be 1 or 2 ticks.
    const bins: DistributionBin[] = [
      { ticks: 1, count: 1 },
      { ticks: 2, count: 1 },
    ];
    const dist = { bins, total: 2 };
    const result = convolveDistributions([dist, dist], 10);

    // Sum=2: (1,1) -> P=0.25
    expect(result[2]).toBeCloseTo(0.25);
    // Sum=3: (1,2) or (2,1) -> P=0.5
    expect(result[3]).toBeCloseTo(0.5);
    // Sum=4: (2,2) -> P=0.25
    expect(result[4]).toBeCloseTo(0.25);
  });

  it('respects maxSum cutoff', () => {
    const bins: DistributionBin[] = [
      { ticks: 5, count: 1 },
      { ticks: 10, count: 1 },
    ];
    const dist = { bins, total: 2 };
    const result = convolveDistributions([dist, dist], 12);

    // Sum=10: (5,5) -> P=0.25
    expect(result[10]).toBeCloseTo(0.25);
    // Sum=15 and 20 would exceed maxSum=12, so they are not in the result.
    expect(result.length).toBe(13);
  });
});

describe('targetProbability', () => {
  it('sums convolved distribution up to target', () => {
    const convolved = new Float64Array(5);
    convolved[2] = 0.25;
    convolved[3] = 0.5;
    convolved[4] = 0.25;

    expect(targetProbability(convolved, 1)).toBe(0);
    expect(targetProbability(convolved, 2)).toBeCloseTo(0.25);
    expect(targetProbability(convolved, 3)).toBeCloseTo(0.75);
    expect(targetProbability(convolved, 4)).toBeCloseTo(1.0);
    expect(targetProbability(convolved, 100)).toBeCloseTo(1.0);
  });
});

describe('convolvedPercentile', () => {
  it('returns the tick where cumulative probability reaches threshold', () => {
    const convolved = new Float64Array(5);
    convolved[2] = 0.25;
    convolved[3] = 0.5;
    convolved[4] = 0.25;

    expect(convolvedPercentile(convolved, 0.25)).toBe(2);
    expect(convolvedPercentile(convolved, 0.5)).toBe(3);
    expect(convolvedPercentile(convolved, 0.75)).toBe(3);
    expect(convolvedPercentile(convolved, 1.0)).toBe(4);
  });

  it('returns null if threshold is never reached', () => {
    const convolved = new Float64Array(5);
    convolved[2] = 0.3;
    // Total probability mass is only 0.3.
    expect(convolvedPercentile(convolved, 0.5)).toBeNull();
  });

  it('returns 0 when all mass is at tick 0', () => {
    const convolved = new Float64Array(3);
    convolved[0] = 1.0;
    expect(convolvedPercentile(convolved, 0.5)).toBe(0);
  });
});

describe('formatPercentile', () => {
  it('formats very low percentiles', () => {
    expect(formatPercentile(0.05)).toBe('<0.1%');
  });

  it('formats very high percentiles', () => {
    expect(formatPercentile(99.95)).toBe('>99.9%');
  });

  it('formats low percentiles with < prefix', () => {
    expect(formatPercentile(25)).toBe('<25.0%');
    expect(formatPercentile(0.5)).toBe('<0.5%');
  });

  it('formats high percentiles with > prefix', () => {
    expect(formatPercentile(75)).toBe('>75.0%');
    expect(formatPercentile(99)).toBe('>99.0%');
  });

  it('formats 50th percentile with > prefix', () => {
    expect(formatPercentile(50)).toBe('>50.0%');
  });
});
