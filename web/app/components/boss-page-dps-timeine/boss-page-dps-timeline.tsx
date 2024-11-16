'use client';

import {
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Area,
  AreaChart,
  ReferenceLine,
} from 'recharts';

import styles from './styles.module.scss';

type BossPageDPSTimelineProps = {
  currentTick: number;
  data: {
    tick: number;
    bossHealthPercentage: number;
  }[];
  width: number;
  height: number;
};

export function BossPageDPSTimeline(props: BossPageDPSTimelineProps) {
  const { data, width, height } = props;

  return (
    <div className={styles.chartParent}>
      <AreaChart
        width={width}
        height={height}
        data={data}
        margin={{ left: -10 }}
      >
        <CartesianGrid strokeDasharray="1 1" />
        <XAxis dataKey="tick" />
        <YAxis unit="%" />
        <Area
          type="monotone"
          dataKey="bossHealthPercentage"
          stroke="#ffffff"
          fill="#532727"
        />
        <Tooltip
          contentStyle={{ backgroundColor: '#171821' }}
          formatter={(value: number) => {
            return [`${value.toFixed(2)}%`, 'Health'];
          }}
          labelFormatter={(value: number) => `Tick: ${value}`}
        />
        <ReferenceLine x={props.currentTick} stroke="#ffffff" />
      </AreaChart>
    </div>
  );
}
