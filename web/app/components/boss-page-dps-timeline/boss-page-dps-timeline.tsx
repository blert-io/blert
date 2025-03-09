'use client';

import {
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Area,
  AreaChart,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts';

import styles from './styles.module.scss';

type BossPageDPSTimelineProps = {
  currentTick: number;
  data: {
    tick: number;
    bossHealthPercentage: number;
  }[];
  width: number | string;
  height: number | string;
};

export function BossPageDPSTimeline(props: BossPageDPSTimelineProps) {
  const { data, width, height } = props;

  return (
    <div
      className={styles.chartParent}
      style={{ width, height }}
      data-blert-disable-sidebar="true"
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ left: -10 }}>
          <defs>
            <linearGradient id="healthGradient" x1="0" y1="0" x2="0" y2="1">
              <stop
                offset="0%"
                stopColor="var(--blert-red)"
                stopOpacity={0.3}
              />
              <stop
                offset="100%"
                stopColor="var(--blert-red)"
                stopOpacity={0.05}
              />
            </linearGradient>
          </defs>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--nav-bg-lightened)"
            opacity={0.9}
          />
          <XAxis
            dataKey="tick"
            stroke="var(--font-color-nav)"
            tickLine={false}
            axisLine={{ stroke: 'var(--nav-bg-lightened)' }}
          />
          <YAxis
            unit="%"
            stroke="var(--font-color-nav)"
            tickLine={false}
            axisLine={{ stroke: 'var(--nav-bg-lightened)' }}
          />
          <Area
            type="monotone"
            dataKey="bossHealthPercentage"
            stroke="rgba(var(--blert-red-base), 0.7)"
            strokeWidth={2}
            fill="url(#healthGradient)"
          />
          <Tooltip
            contentStyle={{
              backgroundColor: 'var(--nav-bg)',
              border: '1px solid var(--nav-bg-lightened)',
              borderRadius: '8px',
              color: 'var(--blert-text-color)',
              padding: '8px',
            }}
            formatter={(value: number) => {
              return [`${value.toFixed(2)}%`, 'Health'];
            }}
            labelFormatter={(value: number) => `Tick: ${value}`}
            cursor={{ stroke: 'var(--font-color-nav-divider)', strokeWidth: 1 }}
          />
          <ReferenceLine
            x={props.currentTick}
            stroke="var(--blert-red)"
            strokeWidth={2}
            strokeDasharray="3 3"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
