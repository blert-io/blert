'use client';

import { useMemo } from 'react';
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

const CHART_MARGIN = { left: -10 };
const AXIS_LINE = { stroke: 'var(--blert-surface-light)' };
const TOOLTIP_STYLE = {
  backgroundColor: 'var(--blert-surface-dark)',
  border: '1px solid var(--blert-surface-light)',
  borderRadius: '8px',
  color: 'var(--blert-font-color-primary)',
  padding: '8px',
};
const TOOLTIP_CURSOR = {
  stroke: 'var(--blert-divider-color)',
  strokeWidth: 1,
};

const MAX_X_TICKS = 20;

/**
 * Generates up to `maxTicks` evenly-spaced tick values using a "nice" interval
 * (1, 2, 5, 10, 20, 50, 100, ...).
 */
function generateTicks(maxValue: number, maxTicks: number): number[] {
  if (maxValue <= 0) {
    return [0];
  }

  if (maxValue <= maxTicks) {
    return Array.from({ length: maxValue + 1 }, (_, i) => i);
  }

  const rawInterval = maxValue / maxTicks;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawInterval)));
  const residual = rawInterval / magnitude;

  let niceInterval: number;
  if (residual <= 1) {
    niceInterval = magnitude;
  } else if (residual <= 2) {
    niceInterval = 2 * magnitude;
  } else if (residual <= 5) {
    niceInterval = 5 * magnitude;
  } else {
    niceInterval = 10 * magnitude;
  }

  const ticks: number[] = [];
  for (let t = 0; t <= maxValue; t += niceInterval) {
    ticks.push(t);
  }
  return ticks;
}

function formatHealth(value: number) {
  return [`${value.toFixed(2)}%`, 'Health'];
}

function formatTick(value: number) {
  return `Tick: ${value}`;
}

type BossPageDPSTimelineProps = {
  currentTick: number;
  data: {
    tick: number;
    bossHealthPercentage: number;
  }[];
  width: number | string;
  height: number | string;
  /** Whether to animate chart transitions. Defaults to true. */
  animate?: boolean;
};

export function BossPageDPSTimeline(props: BossPageDPSTimelineProps) {
  const { data, width, height, animate = true } = props;

  const maxTick = data.length > 0 ? data[data.length - 1].tick : 0;
  const xTicks = useMemo(() => generateTicks(maxTick, MAX_X_TICKS), [maxTick]);

  return (
    <div
      className={styles.chartParent}
      style={{ width, height }}
      data-blert-disable-sidebar="true"
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={CHART_MARGIN}>
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
            stroke="var(--blert-surface-light)"
            opacity={0.9}
          />
          <XAxis
            dataKey="tick"
            stroke="var(--blert-font-color-secondary)"
            tickLine={false}
            axisLine={AXIS_LINE}
            ticks={xTicks}
          />
          <YAxis
            unit="%"
            stroke="var(--blert-font-color-secondary)"
            tickLine={false}
            axisLine={AXIS_LINE}
          />
          <Area
            type="monotone"
            dataKey="bossHealthPercentage"
            stroke="rgba(var(--blert-red-base), 0.7)"
            strokeWidth={2}
            fill="url(#healthGradient)"
            isAnimationActive={animate}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            formatter={formatHealth}
            labelFormatter={formatTick}
            cursor={TOOLTIP_CURSOR}
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
