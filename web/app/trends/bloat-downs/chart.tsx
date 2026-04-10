'use client';

import { useMemo } from 'react';
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { Series } from './bloat-downs';

type ChartDatum = {
  ticks: number;
} & Record<string, number>;

type SeriesStats = {
  id: string;
  label: string;
  color: string;
  total: number;
};

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

function generateTicks(min: number, max: number, maxTicks: number): number[] {
  const range = max - min;
  if (range <= 0) {
    return [min];
  }
  const step = Math.max(niceStep(range, maxTicks), 1);
  const start = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let t = start; t <= max; t += step) {
    ticks.push(Math.round(t));
  }
  return ticks;
}

type BloatDownsChartProps = {
  series: Series[];
};

export default function BloatDownsChart({ series }: BloatDownsChartProps) {
  const { data, domain, stats, maxProb } = useMemo(() => {
    const stats: SeriesStats[] = series.map((s) => {
      let total = 0;
      if (s.data !== null) {
        for (const count of Object.values(s.data.byWalkTicks)) {
          total += count;
        }
      }
      return { id: s.id, label: s.label, color: s.color, total };
    });

    const allTicks = new Set<number>();
    for (const s of series) {
      if (s.data === null) {
        continue;
      }
      for (const key of Object.keys(s.data.byWalkTicks)) {
        allTicks.add(parseInt(key));
      }
    }

    if (allTicks.size === 0) {
      return {
        data: [] as ChartDatum[],
        domain: [0, 1] as [number, number],
        stats,
        maxProb: 0,
      };
    }

    const minTick = Math.min(...allTicks);
    const maxTick = Math.max(...allTicks);

    const filled: ChartDatum[] = [];
    const cumulative: Record<string, number> = {};
    for (const s of series) {
      cumulative[s.id] = 0;
    }

    let peak = 0;
    for (let t = minTick; t <= maxTick; t++) {
      const datum: ChartDatum = { ticks: t };
      for (const s of series) {
        const stat = stats.find((st) => st.id === s.id)!;
        const count = s.data?.byWalkTicks[t.toString()] ?? 0;
        cumulative[s.id] += count;
        const prob = stat.total > 0 ? count / stat.total : 0;
        if (prob > peak) {
          peak = prob;
        }
        datum[`${s.id}_prob`] = prob;
        datum[`${s.id}_cdf`] =
          stat.total > 0 ? (cumulative[s.id] / stat.total) * 100 : 0;
      }
      filled.push(datum);
    }

    // Pad the domain on each side so edge bars aren't clipped.
    const domainMin = minTick - 1;
    const domainMax = maxTick + 1;

    // Sentinel data points so each CDF area extends from 0% at the left edge
    // of the chart to 100% at the right edge, instead of starting and ending
    // mid-axis where the data happens to fall.
    const leftSentinel: ChartDatum = { ticks: domainMin };
    const rightSentinel: ChartDatum = { ticks: domainMax };
    for (const s of series) {
      leftSentinel[`${s.id}_cdf`] = 0;
      rightSentinel[`${s.id}_cdf`] = 100;
    }
    filled.unshift(leftSentinel);
    filled.push(rightSentinel);

    return {
      data: filled,
      domain: [domainMin, domainMax] as [number, number],
      stats,
      maxProb: peak,
    };
  }, [series]);

  const xTicks = useMemo(
    () => generateTicks(domain[0], domain[1], 10),
    [domain],
  );

  const probDomain = useMemo<[number, number]>(() => {
    if (maxProb <= 0) {
      return [0, 0.01];
    }
    const maxPct = maxProb * 100;
    const step = niceStep(maxPct, 4);
    const top = Math.ceil(maxPct / step) * step + step;
    return [0, top / 100];
  }, [maxProb]);

  const probTicks = useMemo(() => {
    if (probDomain[1] <= 0) {
      return [0];
    }
    const top = probDomain[1] * 100;
    const step = niceStep(top, 4);
    const ticks: number[] = [];
    for (let p = 0; p <= top + 1e-9; p += step) {
      ticks.push(p / 100);
    }
    return ticks;
  }, [probDomain]);

  if (data.length === 0) {
    return null;
  }

  return (
    <ResponsiveContainer width="100%" height={380}>
      <ComposedChart
        data={data}
        margin={{ top: 10, right: 45, bottom: 10, left: 5 }}
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
          tickFormatter={(t: number) => `${t}t`}
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
          width={50}
        />
        <YAxis
          yAxisId="cdf"
          orientation="right"
          domain={[0, 100]}
          ticks={[0, 25, 50, 75, 100]}
          tickFormatter={(v: number) => `${v}%`}
          tick={{ fontSize: 10, fill: '#5e6288' }}
          axisLine={false}
          tickLine={false}
          width={40}
        />
        <Tooltip
          cursor={{ fill: 'rgba(88, 101, 242, 0.1)' }}
          content={({ active, payload, label }) => {
            if (
              active !== true ||
              payload === undefined ||
              payload.length === 0
            ) {
              return null;
            }
            const ticks = label as number;
            return (
              <div
                style={{
                  background: 'rgb(27, 28, 37)',
                  border: '1px solid #4b4e6d',
                  borderRadius: 6,
                  fontSize: '0.85rem',
                  padding: '8px 10px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                }}
              >
                <div
                  style={{
                    color: 'var(--blert-font-color-primary)',
                    fontWeight: 600,
                    marginBottom: 2,
                  }}
                >
                  {ticks}t
                </div>
                {stats.map((s) => {
                  const probEntry = payload.find(
                    (p) => p.dataKey === `${s.id}_prob`,
                  );
                  const cdfEntry = payload.find(
                    (p) => p.dataKey === `${s.id}_cdf`,
                  );
                  const prob = ((probEntry?.value as number) ?? 0) * 100;
                  const cdf = (cdfEntry?.value as number) ?? 0;
                  return (
                    <div key={s.id} style={{ color: s.color }}>
                      {s.label}: {prob.toFixed(2)}% (cum. {cdf.toFixed(1)}%)
                    </div>
                  );
                })}
              </div>
            );
          }}
        />
        <Legend
          verticalAlign="top"
          height={32}
          iconType="rect"
          wrapperStyle={{ fontSize: '0.85rem' }}
          payload={stats.map((s) => ({
            id: s.id,
            value: s.label,
            type: 'rect',
            color: s.color,
          }))}
        />
        {stats.map((s) => (
          <Bar
            key={`${s.id}-prob`}
            yAxisId="prob"
            dataKey={`${s.id}_prob`}
            fill={s.color}
            fillOpacity={0.55}
            radius={[1, 1, 0, 0]}
            isAnimationActive={false}
          />
        ))}
        {stats.map((s) => (
          <Area
            key={`${s.id}-cdf`}
            yAxisId="cdf"
            dataKey={`${s.id}_cdf`}
            type="stepAfter"
            stroke={s.color}
            strokeWidth={2}
            strokeOpacity={0.4}
            fill={s.color}
            fillOpacity={0.04}
            dot={false}
            isAnimationActive={false}
            legendType="none"
          />
        ))}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
