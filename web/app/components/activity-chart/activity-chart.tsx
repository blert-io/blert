import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import styles from './style.module.scss';

type ActivityData = {
  hour: number;
  count: number;
};

type ActivityChartProps = {
  data: ActivityData[];
  title?: string;
  icon?: string;
  timeRange?: string;
  height?: number;
  valueLabel?: string;
  startHour?: number;
};

export default function ActivityChart({
  data,
  title = 'Activity',
  icon = 'fas fa-chart-line',
  timeRange = 'Last 24h',
  height = 100,
  valueLabel = 'raids',
  startHour,
}: ActivityChartProps) {
  startHour ??= new Date().getUTCHours();

  return (
    <div className={styles.activityChart}>
      <div className={styles.chartTitle}>
        <div className={styles.chartTitleMain}>
          <i className={icon} />
          <span>{title}</span>
        </div>
        <div className={styles.chartTimeRange}>
          <i className="fas fa-clock" />
          <span>{timeRange}</span>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart
          data={data}
          margin={{ top: 5, right: 15, left: 15, bottom: 5 }}
        >
          <defs>
            <linearGradient id="activityGradient" x1="0" y1="0" x2="0" y2="1">
              <stop
                offset="0%"
                stopColor="var(--blert-button)"
                stopOpacity={0.3}
              />
              <stop
                offset="100%"
                stopColor="var(--blert-button)"
                stopOpacity={0}
              />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="hour"
            interval={3}
            tickFormatter={(hour) =>
              `${((startHour + hour) % 24).toString().padStart(2, '0')}:00`
            }
            stroke="var(--font-color-nav)"
            tick={{ fontSize: 10 }}
            tickLine={false}
            minTickGap={20}
          />
          <YAxis hide />
          <Tooltip
            contentStyle={{
              background: 'var(--nav-bg)',
              border: 'none',
              borderRadius: '4px',
              fontSize: '12px',
            }}
            formatter={(value) => [`${value} ${valueLabel}`, 'Active']}
            labelFormatter={(hour) => {
              const labelHour = (startHour + hour) % 24;
              return `${labelHour.toString().padStart(2, '0')}:00 UTC`;
            }}
          />
          <Area
            type="monotone"
            dataKey="count"
            stroke="var(--blert-button)"
            strokeWidth={2}
            fill="url(#activityGradient)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
