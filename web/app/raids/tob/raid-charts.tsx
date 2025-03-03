'use client';

import { ChallengeMode, ChallengeStatus, ChallengeType } from '@blert/common';
import {
  Bar,
  BarChart,
  Cell,
  LabelList,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { useClientOnly } from '@/hooks/client-only';
import {
  modeNameAndColor,
  scaleNameAndColor,
  statusNameAndColor,
} from '@/components/raid-quick-details';

import styles from './style.module.scss';

const CHART_SIZE = 248;
const TOOLTIP_WIDTH = 150;
const TOOLTIP_HEIGHT = 45;

type ChartValue<T> = {
  key: T;
  value: number;
};

type RaidChartsProps = {
  modeData: ChartValue<ChallengeMode>[];
  playerData: ChartValue<string>[];
  scaleData: ChartValue<number>[];
  statusData: ChartValue<ChallengeStatus>[];
};

export default function RaidCharts({
  modeData,
  playerData,
  scaleData,
  statusData,
}: RaidChartsProps) {
  const isClient = useClientOnly();
  const chartOrPlaceholder = (data: ChartValue<any>[], chart: JSX.Element) => (
    <>
      {isClient && data.length > 0
        ? chart
        : chartPlaceholder(data.length === 0)}
    </>
  );

  const modes = modeData.map((v) => {
    const [name, color] = modeNameAndColor(ChallengeType.TOB, v.key, false);
    return { name, color, ...v };
  });

  const statuses = statusData.map((v) => {
    let [name, color] = statusNameAndColor(v.key);
    if (v.key === ChallengeStatus.COMPLETED) {
      name = 'Complete';
    }
    return { name, color, ...v };
  });

  const scales = scaleData.map((v) => {
    const [name, color] = scaleNameAndColor(v.key);
    return { name, color, ...v };
  });

  const chartPlaceholder = (empty: boolean) => (
    <div style={{ width: CHART_SIZE, height: CHART_SIZE }}>
      {empty && <div className={styles.empty}>No data available</div>}
    </div>
  );

  const tooltip = (
    <Tooltip
      separator=" - "
      contentStyle={{
        backgroundColor: '#171821',
        borderRadius: 5,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        width: TOOLTIP_WIDTH,
        height: TOOLTIP_HEIGHT,
      }}
      formatter={(value: number) => {
        return `${value} raid${value === 1 ? '' : 's'}`;
      }}
      itemStyle={{ color: '#fff' }}
    />
  );

  return (
    <>
      <div className={styles.charts}>
        <div className={styles.chart}>
          <h3>By scale</h3>
          {chartOrPlaceholder(
            scales,
            <PieChart width={CHART_SIZE} height={CHART_SIZE}>
              <Pie
                data={scales}
                dataKey="value"
                cx="50%"
                cy="50%"
                outerRadius="80%"
                innerRadius="50%"
                stroke="#1b1c25"
              >
                {scales.map((v, i) => (
                  <Cell key={`cell-${i}`} fill={v.color} />
                ))}
              </Pie>
              <Legend />
              {tooltip}
            </PieChart>,
          )}
        </div>
        <div className={styles.chart}>
          <h3>By mode</h3>
          {chartOrPlaceholder(
            modes,
            <PieChart width={CHART_SIZE} height={CHART_SIZE}>
              <Pie
                data={modes}
                dataKey="value"
                cx="50%"
                cy="50%"
                outerRadius="80%"
                innerRadius="50%"
                stroke="#1b1c25"
              >
                {modes.map((v, i) => (
                  <Cell key={`cell-${i}`} fill={v.color} />
                ))}
              </Pie>
              <Legend />
              {tooltip}
            </PieChart>,
          )}
        </div>
        <div className={styles.chart}>
          <h3>By status</h3>
          {chartOrPlaceholder(
            statuses,
            <PieChart width={CHART_SIZE} height={CHART_SIZE}>
              <Pie
                data={statuses}
                dataKey="value"
                cx="50%"
                cy="50%"
                outerRadius="80%"
                innerRadius="50%"
                stroke="#1b1c25"
              >
                {statuses.map((v, i) => {
                  return <Cell key={`cell-${i}`} fill={v.color} />;
                })}
              </Pie>
              <Legend />
              {tooltip}
            </PieChart>,
          )}
        </div>
      </div>
      <div className={styles.divider} />
      <div className={styles.players}>
        <h3>Most active players</h3>
        <ResponsiveContainer width="100%" height={400}>
          {playerData.length === 0 ? (
            <div className={styles.empty}>No player data available</div>
          ) : (
            <BarChart data={playerData} layout="vertical">
              <XAxis
                type="number"
                stroke="var(--blert-text-color)"
                allowDecimals={false}
                domain={[0, 'dataMax']}
              />
              <YAxis
                dataKey="key"
                type="category"
                width={110}
                stroke="var(--blert-text-color)"
              />
              <Bar dataKey="value" fill="#62429b">
                <LabelList dataKey="value" position="insideRight" fill="#fff" />
              </Bar>
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </>
  );
}
