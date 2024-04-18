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

import { CollapsiblePanel } from '../collapsible-panel/collapsible-panel';

import styles from './styles.module.scss';

type BossPageDPSTimelineProps = {
  currentTick: number;
  data: {
    tick: number;
    bossHealthPercentage: number;
  }[];
};

export function BossPageDPSTimeline(props: BossPageDPSTimelineProps) {
  const { data } = props;

  return (
    <CollapsiblePanel
      panelTitle="Charts"
      maxPanelHeight={1000}
      defaultExpanded
      className={styles.dpsTimeline}
    >
      <div className={styles.chartParent}>
        <h3>Maiden&apos;s Health Over Time</h3>
        <AreaChart
          width={1400}
          height={400}
          data={data}
          margin={{
            top: 20,
            right: 20,
            bottom: 20,
            left: 20,
          }}
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
    </CollapsiblePanel>
  );
}
