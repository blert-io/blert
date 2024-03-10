'use client';

import {
  LineChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Legend,
  Line,
  Tooltip,
  Area,
  AreaChart,
} from 'recharts';
import { CollapsiblePanel } from '../collapsible-panel/collapsible-panel';
import styles from './styles.module.scss';

type BossPageDPSTimelineProps = {
  data: {
    tick: number;
    bossHealthPercentage: number;
  }[];
};

export function BossPageDPSTimeline(props: BossPageDPSTimelineProps) {
  const { data } = props;

  console.log('definitely working data:', data);

  return (
    <CollapsiblePanel
      panelTitle={'DPS Timeline'}
      maxPanelHeight={9000}
      defaultExpanded={true}
      className={styles.dpsTImeline}
    >
      <div className={styles.chartParent}>
        <h3>Maidens Health Over Time</h3>
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
          <YAxis />
          <Area
            type="monotone"
            dataKey="bossHealthPercentage"
            stroke="#ffffff"
            fill="#532727"
          />
          <Tooltip itemStyle={{ backgroundColor: '#000' }} />
        </AreaChart>
      </div>
    </CollapsiblePanel>
  );
}
