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

function utcToLocal(utcHour: number) {
  const date = new Date();
  date.setUTCHours(utcHour, 0, 0, 0);
  return date.getHours();
}

function formatHour(hour: number) {
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const h = hour % 12 || 12;
  return `${h}:00 ${ampm}`;
}

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
          margin={{ top: 5, right: 20, left: 20, bottom: 5 }}
        >
          <defs>
            <linearGradient id="activityGradient" x1="0" y1="0" x2="0" y2="1">
              <stop
                offset="0%"
                stopColor="var(--blert-purple)"
                stopOpacity={0.3}
              />
              <stop
                offset="100%"
                stopColor="var(--blert-purple)"
                stopOpacity={0}
              />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="hour"
            interval={3}
            tickFormatter={(hour) =>
              formatHour(utcToLocal((startHour + hour) % 24))
            }
            stroke="var(--blert-font-color-secondary)"
            tick={{ fontSize: 10 }}
            tickLine={false}
            minTickGap={20}
          />
          <YAxis hide />
          <Tooltip
            contentStyle={{
              background: 'var(--blert-surface-dark)',
              border: 'none',
              borderRadius: '4px',
              fontSize: '12px',
            }}
            formatter={(value) => [`${String(value)} ${valueLabel}`, 'Active']}
            labelFormatter={(hour) => {
              const localHour = utcToLocal((startHour + hour) % 24);
              return formatHour(localHour);
            }}
          />
          <Area
            type="monotone"
            dataKey="count"
            stroke="var(--blert-purple)"
            strokeWidth={2}
            fill="url(#activityGradient)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
