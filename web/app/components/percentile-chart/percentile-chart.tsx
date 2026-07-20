'use client';

import { useMemo } from 'react';
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  ErrorBar,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { ticksToFormattedSeconds } from '@/utils/tick';

import styles from './style.module.scss';

export type PercentileStats = {
  p5: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
};

export type PlayerMark = {
  /** Median ticks across the player's own runs. */
  median: number;
  /** Number of the player's runs contributing to the median. */
  count: number;
  /** The player's standing within the global distribution, as "top X%". */
  percentile?: number;
};

export type PercentileCategory = {
  key: number | string;
  /** Short axis label. */
  label: string;
  /** Full name shown in the tooltip. Defaults to `label`. */
  name?: string;
  /** Number of samples in the distribution. */
  count: number;
  stats: PercentileStats;
  player?: PlayerMark;
};

type PercentileChartProps = {
  categories: PercentileCategory[];
  /** Title displayed above the chart. */
  title?: string;
  /** Name of the overlaid player, shown in the legend and tooltip. */
  playerName?: string;
  onCategoryClick?: (key: number | string) => void;
  /** Key of the currently selected category, highlighted in the chart. */
  selectedKey?: number | string | null;
  height?: number;
  /** Y axis tick interval in game ticks. Defaults to 50. */
  yTickInterval?: number;
};

type ChartRow = {
  key: number | string;
  label: string;
  name: string;
  count: number;
  stats: PercentileStats;
  base: number;
  box: number;
  median: number;
  whisker: [number, number];
  player: number | null;
  playerMark: PlayerMark | null;
};

const AXIS_TICK = { fontSize: 11, fill: 'var(--blert-font-color-secondary)' };

function CategoryTick({
  x,
  y,
  payload,
  data,
  onCategoryClick,
  selectedKey,
}: {
  x?: number;
  y?: number;
  payload?: { value: string };
  data: ChartRow[];
  onCategoryClick?: (key: number | string) => void;
  selectedKey?: number | string | null;
}) {
  const row = data.find((r) => r.label === payload?.value);
  const clickable = onCategoryClick !== undefined && row !== undefined;
  const selected =
    row !== undefined &&
    selectedKey !== undefined &&
    selectedKey !== null &&
    row.key === selectedKey;

  const classNames = [
    styles.axisTick,
    clickable && styles.clickable,
    selected && styles.active,
  ].filter(Boolean);

  return (
    <text
      x={x}
      y={(y ?? 0) + 12}
      textAnchor="middle"
      className={classNames.join(' ')}
      onClick={clickable ? () => onCategoryClick(row.key) : undefined}
    >
      {payload?.value}
    </text>
  );
}

function formatTicks(ticks: number): string {
  return ticksToFormattedSeconds(Math.round(ticks));
}

function MedianDot(props: { cx?: number; cy?: number }) {
  const { cx, cy } = props;
  if (cx === undefined || cy === undefined) {
    return null;
  }
  return (
    <circle
      cx={cx}
      cy={cy}
      r={4.5}
      fill="var(--blert-font-color-primary)"
      stroke="var(--blert-panel-background-color)"
      strokeWidth={2}
    />
  );
}

function PlayerDot(props: { cx?: number; cy?: number }) {
  const { cx, cy } = props;
  if (cx === undefined || cy === undefined) {
    return null;
  }
  return (
    <circle
      cx={cx}
      cy={cy}
      r={5}
      fill="var(--blert-yellow)"
      stroke="var(--blert-panel-background-color)"
      strokeWidth={2}
    />
  );
}

function ChartTooltip({
  active,
  payload,
  playerName,
}: {
  active?: boolean;
  payload?: { payload: ChartRow }[];
  playerName?: string;
}) {
  if (!active || payload === undefined || payload.length === 0) {
    return null;
  }

  const row = payload[0].payload;
  const percentiles: [string, number][] = [
    ['5th', row.stats.p5],
    ['25th', row.stats.p25],
    ['Median', row.stats.p50],
    ['75th', row.stats.p75],
    ['95th', row.stats.p95],
  ];

  return (
    <div className={styles.tooltip}>
      <div className={styles.tooltipHeader}>
        {row.name}
        <span className={styles.tooltipCount}>
          {row.count} sample{row.count === 1 ? '' : 's'}
        </span>
      </div>
      <div className={styles.tooltipBody}>
        {percentiles.map(([label, value]) => (
          <div key={label} className={styles.tooltipRow}>
            <span>{label}</span>
            <span className={styles.tooltipValue}>{formatTicks(value)}</span>
          </div>
        ))}
      </div>
      {row.playerMark !== null && (
        <div className={styles.tooltipPlayer}>
          <div className={styles.tooltipRow}>
            <span>
              <i className={styles.playerSwatch} />
              {playerName ?? 'Player'}
            </span>
            <span className={styles.tooltipValue}>
              {formatTicks(row.playerMark.median)}
            </span>
          </div>
          {row.playerMark.percentile !== undefined && (
            <div className={styles.tooltipStanding}>
              Top {row.playerMark.percentile.toFixed(1)}% of{' '}
              {row.count.toLocaleString()} samples
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function PercentileChart({
  categories,
  title,
  playerName,
  onCategoryClick,
  selectedKey = null,
  height = 500,
  yTickInterval = 50,
}: PercentileChartProps) {
  const data: ChartRow[] = useMemo(
    () =>
      categories.map((c) => ({
        key: c.key,
        label: c.label,
        name: c.name ?? c.label,
        count: c.count,
        stats: c.stats,
        base: c.stats.p25,
        box: c.stats.p75 - c.stats.p25,
        median: c.stats.p50,
        whisker: [c.stats.p50 - c.stats.p5, c.stats.p95 - c.stats.p50],
        player: c.player?.median ?? null,
        playerMark: c.player ?? null,
      })),
    [categories],
  );

  const hasPlayer = data.some((row) => row.player !== null);

  // The auto domain only considers plotted data keys, not ErrorBar extents,
  // so the p95 whiskers would clip without an explicit maximum.
  const { yMax, yTicks } = useMemo(() => {
    const max = data.reduce(
      (acc, row) => Math.max(acc, row.stats.p95, row.player ?? 0),
      0,
    );
    const yMax = (Math.floor(max / yTickInterval) + 1) * yTickInterval;
    const yTicks = [];
    for (let t = 0; t <= yMax; t += yTickInterval) {
      yTicks.push(t);
    }
    return { yMax, yTicks };
  }, [data, yTickInterval]);

  const handleClick = (row: unknown) => {
    if (onCategoryClick !== undefined) {
      onCategoryClick((row as ChartRow).key);
    }
  };

  return (
    <div className={styles.percentileChart}>
      <div className={styles.chartHeader}>
        {title !== undefined && <h3 className={styles.title}>{title}</h3>}
        <div className={styles.legend}>
          <span className={styles.legendItem}>
            <i className={styles.globalSwatch} />
            25th&ndash;75th percentile
          </span>
          <span className={styles.legendItem}>
            <i className={styles.whiskerSwatch} />
            5th&ndash;95th percentile
          </span>
          <span className={styles.legendItem}>
            <i className={styles.medianSwatch} />
            Median
          </span>
          {hasPlayer && (
            <span className={styles.legendItem}>
              <i className={styles.playerSwatch} />
              {playerName ?? 'Player'}
            </span>
          )}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart
          data={data}
          margin={{ top: 10, right: 10, bottom: 5, left: 5 }}
        >
          <CartesianGrid
            horizontal
            vertical={false}
            stroke="rgba(var(--blert-divider-color-base), 0.3)"
          />
          <XAxis
            dataKey="label"
            interval={0}
            tick={
              <CategoryTick
                data={data}
                onCategoryClick={onCategoryClick}
                selectedKey={selectedKey}
              />
            }
            axisLine={{ stroke: 'var(--blert-divider-color)' }}
            tickLine={false}
          />
          <YAxis
            domain={[0, yMax]}
            ticks={yTicks}
            tickFormatter={formatTicks}
            tick={AXIS_TICK}
            axisLine={false}
            tickLine={false}
            width={52}
          />
          <Tooltip
            content={<ChartTooltip playerName={playerName} />}
            cursor={{ fill: 'rgba(var(--blert-purple-base), 0.08)' }}
          />
          <Bar dataKey="base" stackId="box" fill="transparent" />
          <Bar
            dataKey="box"
            stackId="box"
            fill="rgba(var(--blert-purple-base), 0.45)"
            stroke="var(--blert-purple)"
            strokeWidth={1}
            radius={3}
            barSize={26}
            onClick={handleClick}
            className={onCategoryClick !== undefined ? styles.clickable : ''}
            isAnimationActive={false}
            activeBar={{
              fill: 'rgba(var(--blert-purple-base), 0.65)',
              strokeWidth: 1.5,
            }}
          >
            {data.map((row) => (
              <Cell
                key={row.key}
                fill={
                  row.key === selectedKey
                    ? 'rgba(var(--blert-purple-base), 0.7)'
                    : 'rgba(var(--blert-purple-base), 0.45)'
                }
                strokeWidth={row.key === selectedKey ? 2 : 1}
              />
            ))}
          </Bar>
          <Scatter
            dataKey="median"
            shape={<MedianDot />}
            isAnimationActive={false}
          >
            <ErrorBar
              dataKey="whisker"
              stroke="rgba(var(--blert-purple-base), 0.8)"
              strokeWidth={1.5}
              width={8}
            />
          </Scatter>
          {hasPlayer && (
            <Scatter
              dataKey="player"
              shape={<PlayerDot />}
              isAnimationActive={false}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
