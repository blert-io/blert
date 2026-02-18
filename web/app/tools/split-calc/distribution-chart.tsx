'use client';

import { useMemo } from 'react';
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { ticksToFormattedSeconds } from '@/utils/tick';

import { DistributionBin } from './types';

import styles from './style.module.scss';

type DistributionChartProps = {
  bins: DistributionBin[];
  referenceTicks?: number | null;
  /** Tick cycle for the x-axis step. Defaults to 1. */
  tickCycle?: number;
};

type ChartDatum = {
  ticks: number;
  probability: number;
  cdf: number;
};

/**
 * Picks a "nice" step size for an axis given the range and desired number of
 * ticks. Steps are rounded up to the nearest value in the sequence
 * 1, 2, 5, 10, 20, 50, ...
 */
function niceStep(range: number, maxTicks: number): number {
  const raw = range / maxTicks;
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  const normalized = raw / magnitude;

  let step: number;
  if (normalized <= 1) {
    step = 1;
  } else if (normalized <= 2) {
    step = 2;
  } else if (normalized <= 5) {
    step = 5;
  } else {
    step = 10;
  }

  return step * magnitude;
}

/**
 * Generates evenly-spaced tick values aligned to a nice step size.
 */
function generateTicks(min: number, max: number, maxTicks: number): number[] {
  const range = max - min;
  if (range <= 0) {
    return [min];
  }

  const step = niceStep(range, maxTicks);
  const start = Math.ceil(min / step) * step;
  const ticks: number[] = [];

  for (let t = start; t <= max; t += step) {
    ticks.push(t);
  }

  return ticks;
}

/**
 * Generates probability axis ticks at clean percentage intervals.
 */
function generateProbTicks(maxProb: number): number[] {
  if (maxProb <= 0) {
    return [0];
  }

  const maxPct = maxProb * 100;
  const step = niceStep(maxPct, 4);
  const ticks: number[] = [0];

  // Always include one step beyond the max.
  const limit = maxPct + step;
  for (let p = step; p <= limit; p += step) {
    ticks.push(p / 100);
  }

  return ticks;
}

const CDF_TICKS = [0, 25, 50, 75, 100];

export function DistributionChart({
  bins,
  referenceTicks,
  tickCycle = 1,
}: DistributionChartProps) {
  const { data, domain, maxProb, stub, refCdf } = useMemo(() => {
    if (bins.length === 0) {
      return {
        data: [],
        domain: [0, 1] as [number, number],
        maxProb: 0,
        stub: 0,
        refCdf: null,
      };
    }

    let total = 0;
    for (const bin of bins) {
      total += bin.count;
    }

    const minTick = bins[0].ticks;
    const maxTick = bins[bins.length - 1].ticks;

    const binMap = new Map<number, number>();
    for (const bin of bins) {
      binMap.set(bin.ticks, bin.count);
    }

    // Determine the effective start tick: if the reference is below the minimum
    // recorded tick, extend the chart down to include it.
    const hasRef =
      referenceTicks !== null &&
      referenceTicks !== undefined &&
      referenceTicks > 0;
    const startTick =
      hasRef && referenceTicks < minTick ? referenceTicks : minTick;

    // Fill in gaps to create a continuous x-axis.
    const filled: ChartDatum[] = [];
    let cumulative = 0;
    let peak = 0;

    for (let t = startTick; t <= maxTick; t += tickCycle) {
      const count = binMap.get(t) ?? 0;
      cumulative += count;
      const prob = total > 0 ? count / total : 0;
      if (prob > peak) {
        peak = prob;
      }
      filled.push({
        ticks: t,
        probability: prob,
        cdf: total > 0 ? (cumulative / total) * 100 : 0,
      });
    }

    // Use a tiny stub value for zero-probability bins so they render as a
    // visible sliver rather than being omitted.
    const stub = peak * 0.005;
    for (const d of filled) {
      if (d.probability === 0) {
        d.probability = stub;
      }
    }

    // Extend domain to include reference ticks if outside range.
    let domainMin = minTick;
    let domainMax = maxTick;
    if (
      referenceTicks !== null &&
      referenceTicks !== undefined &&
      referenceTicks > 0
    ) {
      if (referenceTicks < domainMin) {
        domainMin = referenceTicks;
      }
      if (referenceTicks > domainMax) {
        domainMax = referenceTicks;
      }
    }

    // Compute CDF at the reference tick for the horizontal reference line.
    let refCdf: number | null = null;
    if (
      referenceTicks !== null &&
      referenceTicks !== undefined &&
      referenceTicks > 0 &&
      total > 0
    ) {
      let refCumulative = 0;
      for (const bin of bins) {
        if (bin.ticks > referenceTicks) {
          break;
        }
        refCumulative += bin.count;
      }
      refCdf = (refCumulative / total) * 100;
    }

    return {
      data: filled,
      domain: [domainMin, domainMax] as [number, number],
      maxProb: peak,
      stub,
      refCdf,
    };
  }, [bins, referenceTicks, tickCycle]);

  const xTicks = useMemo(() => {
    const ticks = generateTicks(domain[0], domain[1], 10);
    if (
      referenceTicks === null ||
      referenceTicks === undefined ||
      referenceTicks <= 0
    ) {
      return ticks;
    }
    // Drop any axis tick that's too close to the reference line label.
    const range = domain[1] - domain[0];
    const minGap = range * 0.04;
    return ticks.filter((t) => Math.abs(t - referenceTicks) > minGap);
  }, [domain, referenceTicks]);

  const cdfTicks = useMemo(() => {
    if (refCdf === null) {
      return CDF_TICKS;
    }
    // Drop any CDF axis tick that's too close to the reference CDF label.
    return CDF_TICKS.filter((t) => Math.abs(t - refCdf) > 6);
  }, [refCdf]);

  const probTicks = useMemo(() => generateProbTicks(maxProb), [maxProb]);
  const probDomain = useMemo(
    () => [0, probTicks.length > 0 ? probTicks[probTicks.length - 1] : 0.01],
    [probTicks],
  );

  if (data.length === 0) {
    return <div className={styles.noData}>No distribution data available</div>;
  }

  return (
    <div className={styles.chartContainer}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={data}
          margin={{ top: 5, right: 45, bottom: 5, left: 5 }}
        >
          <CartesianGrid
            horizontal
            vertical={false}
            stroke="rgba(75, 78, 109, 0.3)"
          />
          <XAxis
            dataKey="ticks"
            type="number"
            domain={domain}
            ticks={xTicks}
            tickFormatter={(t: number) => ticksToFormattedSeconds(t)}
            tick={{ fontSize: 11, fill: '#5e6288' }}
            axisLine={{ stroke: '#4b4e6d' }}
            tickLine={false}
          />
          <YAxis
            yAxisId="prob"
            orientation="left"
            domain={probDomain}
            ticks={probTicks}
            tickFormatter={(v: number) => `${(v * 100).toFixed(1)}%`}
            tick={{ fontSize: 10, fill: '#5e6288' }}
            axisLine={false}
            tickLine={false}
            width={45}
          />
          <YAxis
            yAxisId="cdf"
            orientation="right"
            domain={[0, 100]}
            ticks={cdfTicks}
            tickFormatter={(v: number) => `${v}%`}
            tick={{ fontSize: 10, fill: '#5e6288' }}
            axisLine={false}
            tickLine={false}
            width={35}
          />
          <Tooltip
            contentStyle={{
              background: 'rgb(27, 28, 37)',
              border: '1px solid #4b4e6d',
              borderRadius: 6,
              fontSize: '0.85rem',
            }}
            labelFormatter={(t) => ticksToFormattedSeconds(t as number)}
            formatter={(value: number, name: string) => {
              if (name === 'probability') {
                const display = value <= stub ? 0 : value;
                return [`${(display * 100).toFixed(2)}%`, 'Probability'];
              }
              return [`${value.toFixed(1)}%`, 'CDF'];
            }}
            cursor={{ fill: 'rgba(88, 101, 242, 0.1)' }}
          />
          <Bar
            yAxisId="prob"
            dataKey="probability"
            fill="rgba(88, 101, 242, 0.5)"
            radius={[1, 1, 0, 0]}
            isAnimationActive={false}
          />
          <Area
            yAxisId="cdf"
            dataKey="cdf"
            type="stepAfter"
            stroke="rgba(196, 181, 253, 0.7)"
            strokeWidth={2}
            fill="rgba(196, 181, 253, 0.06)"
            dot={false}
            isAnimationActive={false}
          />
          {referenceTicks !== null &&
            referenceTicks !== undefined &&
            referenceTicks > 0 && (
              <ReferenceLine
                yAxisId="prob"
                x={referenceTicks}
                stroke="var(--blert-yellow)"
                strokeDasharray="4 4"
                strokeWidth={1.5}
                label={{
                  value: `${ticksToFormattedSeconds(referenceTicks)}`,
                  position: 'bottom',
                  fill: 'var(--blert-yellow)',
                  fontSize: 11,
                  fontWeight: 600,
                }}
              />
            )}
          {refCdf !== null && (
            <ReferenceLine
              yAxisId="cdf"
              y={refCdf}
              stroke="var(--blert-yellow)"
              strokeDasharray="4 4"
              strokeWidth={0.5}
              label={{
                value: `${refCdf.toFixed(1)}%`,
                position: 'right',
                fill: 'var(--blert-yellow)',
                fontSize: 11,
                fontWeight: 600,
              }}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
