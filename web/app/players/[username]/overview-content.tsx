'use client';

import { ChallengeStatus, ChallengeType, SplitType } from '@blert/common';
import Link from 'next/link';
import { Cell, Legend, Pie, PieChart } from 'recharts';
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';

import ActivityChart from '@/components/activity-chart';
import Card, { CardLink } from '@/components/card';
import RadioInput from '@/components/radio-input';
import {
  scaleNameAndColor,
  statusNameAndColor,
} from '@/components/raid-quick-details';
import Statistic from '@/components/statistic';
import { useClientOnly } from '@/hooks/client-only';
import { ticksToFormattedSeconds } from '@/utils/tick';
import { challengeUrl, queryString } from '@/utils/url';

import { usePlayer } from './player-context';

import {
  PLAYER_PAGE_CHART_SIZE,
  PLAYER_PAGE_STATISTIC_SIZE,
} from './dimensions';

import styles from './style.module.scss';

const ACTIVITY_THRESHOLDS = [
  { threshold: 0, color: '#1e1f2e' },
  { threshold: 0.25, color: '#2c2f5a' },
  { threshold: 0.5, color: '#3b4286' },
  { threshold: 0.75, color: '#4a55b2' },
  { threshold: 1, color: 'var(--blert-button)' },
] as const;

type PbEntry = {
  title: string;
  raidId: string | null;
  time: number | null;
};

type PbTableProps = {
  title: string;
  pbs: PbEntry[];
};

function PbTable({ title, pbs }: PbTableProps) {
  const pbOrNone = (pb: number | null) =>
    pb === null ? '--:--.-' : ticksToFormattedSeconds(pb);

  return (
    <div className={styles.pbTable}>
      <h3>{title}</h3>
      <div className={styles.pbs}>
        {pbs.map(
          (pb) =>
            (pb.raidId !== null && (
              <Link
                href={challengeUrl(ChallengeType.TOB, pb.raidId)}
                key={pb.title}
                className={styles.pb}
              >
                <span className={styles.time}>{pbOrNone(pb.time)}</span>
                <span className={styles.scale}>{pb.title}</span>
              </Link>
            )) || (
              <div key={pb.title} className={styles.pb}>
                <span className={styles.time}>{pbOrNone(pb.time)}</span>
                <span className={styles.scale}>{pb.title}</span>
              </div>
            ),
        )}
      </div>
    </div>
  );
}

function scaleName(scale: number) {
  return scale === 1
    ? 'Solo'
    : scale === 2
      ? 'Duo'
      : scale === 3
        ? 'Trio'
        : scale === 4
          ? '4s'
          : '5s';
}

type PlayerOverviewContentProps = {
  personalBests: Array<{
    type: SplitType;
    scale: number;
    ticks: number;
    cid: string;
  }>;
  initialRaidStatuses: Array<{ status: ChallengeStatus; count: number }>;
  initialRaidsByScale: Array<{ scale: number; count: number }>;
  initialRaidsByDay: Array<{ date: Date; count: number }>;
};

function utcDateString(date: Date): string {
  return (
    `${date.getUTCFullYear()}-` +
    `${(date.getUTCMonth() + 1).toString().padStart(2, '0')}-` +
    `${date.getUTCDate().toString().padStart(2, '0')}`
  );
}

function CalendarHeatmap({
  data,
}: {
  data: Array<{ date: Date; count: number }>;
}) {
  const [tooltip, setTooltip] = useState<{
    date: Date;
    count: number;
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const heatmapRef = useRef<HTMLDivElement>(null);

  // Use 8 as the minimum count so that low-activity players don't have a
  // completely bright heatmap.
  const maxCount = Math.max(...data.map((d) => d.count), 8);

  const weeks: Array<Array<{ date: Date; count: number } | null>> = [];

  const today = new Date();
  const todayUTC = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
  );

  const startDate = new Date(todayUTC);
  startDate.setUTCFullYear(startDate.getUTCFullYear() - 1);
  startDate.setUTCDate(startDate.getUTCDate() - startDate.getUTCDay());

  const countMap = new Map(data.map((d) => [utcDateString(d.date), d.count]));

  let currentDate = new Date(startDate);
  let week: Array<{ date: Date; count: number } | null> = [];

  while (currentDate <= new Date(todayUTC)) {
    if (currentDate.getUTCDay() === 0 && week.length > 0) {
      weeks.push(week);
      week = [];
    }

    const count = countMap.get(utcDateString(currentDate)) || 0;
    week.push({ date: new Date(currentDate), count });

    currentDate.setUTCDate(currentDate.getUTCDate() + 1);
  }

  if (week.length > 0) {
    weeks.push(week);
  }

  const monthLabels = weeks.reduce<Array<{ month: string; span: number }>>(
    (acc, week) => {
      const date = week[0]?.date;
      if (!date) {
        return acc;
      }

      const monthStr = new Date(
        Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
      ).toLocaleString('default', { month: 'short' });

      if (acc.length === 0 || acc[acc.length - 1].month !== monthStr) {
        acc.push({ month: monthStr, span: 1 });
      } else {
        acc[acc.length - 1].span++;
      }
      return acc;
    },
    [],
  );

  const getColor = (count: number) => {
    if (count === 0) {
      return ACTIVITY_THRESHOLDS[0].color;
    }

    const ratio = count / maxCount;
    for (const { threshold, color } of ACTIVITY_THRESHOLDS) {
      if (ratio <= threshold) return color;
    }
    return ACTIVITY_THRESHOLDS[ACTIVITY_THRESHOLDS.length - 1].color;
  };

  const handleMouseEnter = (
    day: { date: Date; count: number },
    event: React.MouseEvent<HTMLDivElement>,
  ) => {
    if (!heatmapRef.current) {
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();

    const tooltipWidth = 250;
    const tooltipHeight = 70;

    let left = rect.left + rect.width / 2 - tooltipWidth / 2;
    let top = rect.top - tooltipHeight - 10;

    if (left + tooltipWidth > window.innerWidth) {
      left = window.innerWidth - tooltipWidth - 10;
    }
    if (left < 10) {
      left = 10;
    }
    if (top < 10) {
      top = rect.bottom + 10;
    }

    setTooltip({
      ...day,
      x: left,
      y: top,
      width: tooltipWidth,
      height: tooltipHeight,
    });
  };

  return (
    <div className={styles.heatmap} ref={heatmapRef}>
      <div className={styles.monthLabels}>
        {monthLabels.map(({ month, span }, i) => (
          <div
            key={i}
            style={{
              flex: span,
              minWidth: 0,
            }}
          >
            {month}
          </div>
        ))}
      </div>
      <div className={styles.calendar}>
        <div className={styles.dayLabels}>
          <div>Sun</div>
          <div>Mon</div>
          <div>Tue</div>
          <div>Wed</div>
          <div>Thu</div>
          <div>Fri</div>
          <div>Sat</div>
        </div>
        <div className={styles.weeks}>
          {weeks.map((week, i) => (
            <div key={i} className={styles.week}>
              {week.map((day, j) => (
                <div
                  key={j}
                  className={styles.day}
                  style={{ backgroundColor: getColor(day?.count || 0) }}
                  onMouseEnter={(e) => day && handleMouseEnter(day, e)}
                  onMouseLeave={() => setTooltip(null)}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className={styles.legend}>
        <div className={styles.label}>Less</div>
        {ACTIVITY_THRESHOLDS.map(({ threshold, color }) => (
          <div
            key={threshold}
            className={styles.legendBox}
            style={{ backgroundColor: color }}
          />
        ))}
        <div className={styles.label}>More</div>
      </div>
      {tooltip && (
        <CalendarTooltip
          date={tooltip.date}
          count={tooltip.count}
          initialLeft={tooltip.x}
          initialTop={tooltip.y}
          initialWidth={tooltip.width}
          initialHeight={tooltip.height}
        />
      )}
    </div>
  );
}

function CalendarTooltip({
  date,
  count,
  initialLeft,
  initialTop,
  initialWidth,
  initialHeight,
}: {
  date: Date;
  count: number;
  initialLeft: number;
  initialTop: number;
  initialWidth: number;
  initialHeight: number;
}) {
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number }>({
    left: initialLeft,
    top: initialTop,
  });

  useEffect(() => {
    if (!tooltipRef.current) {
      return;
    }

    const tooltip = tooltipRef.current;
    const rect = tooltip.getBoundingClientRect();

    let left = initialLeft;
    let top = initialTop;

    if (rect.width !== initialWidth) {
      left += (initialWidth - rect.width) / 2;
    }
    if (rect.height !== initialHeight) {
      if (initialTop <= rect.top) {
        top += initialHeight - rect.height;
      }
    }

    if (left + rect.width > window.innerWidth) {
      left = window.innerWidth - rect.width - 10;
    }
    if (left < 10) {
      left = 10;
    }
    if (top < 10) {
      top = rect.bottom + 10;
    }

    setPosition({ left, top });
  }, [initialLeft, initialTop, initialWidth, initialHeight]);

  const formattedDate = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  ).toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });

  return (
    <div
      ref={tooltipRef}
      className={styles.calendarTooltip}
      style={{
        position: 'fixed',
        left: position.left,
        top: position.top,
      }}
    >
      <div className={styles.date}>{formattedDate}</div>
      <div className={styles.count}>
        {count} {count === 1 ? 'raid' : 'raids'}
      </div>
    </div>
  );
}

const enum TimePeriod {
  DAY = 'day',
  WEEK = 'week',
  MONTH = 'month',
  ALL = 'all',
}

function startOfTimePeriod(period: TimePeriod): Date {
  const start = new Date();

  switch (period) {
    case TimePeriod.DAY:
      start.setHours(start.getHours() - 24);
      break;
    case TimePeriod.WEEK:
      start.setDate(start.getDate() - 7);
      break;
    case TimePeriod.MONTH:
      start.setMonth(start.getMonth() - 1);
      break;
    case TimePeriod.ALL:
      return new Date(0);
  }
  return start;
}

type ChallengeStatsResponse = {
  [key: string]: {
    '*': {
      count: number;
    };
  };
};

export default function PlayerOverviewContent({
  personalBests,
  initialRaidStatuses,
  initialRaidsByScale,
  initialRaidsByDay,
}: PlayerOverviewContentProps) {
  const isClient = useClientOnly();
  const player = usePlayer();

  const [timePeriod, setTimePeriod] = useState(TimePeriod.ALL);
  const [loading, setLoading] = useState(false);

  const [activityData, setActivityData] = useState<
    Array<{ hour: number; count: number }>
  >([]);
  const [challengeStatuses, setChallengeStatuses] =
    useState(initialRaidStatuses);
  const [challengeScales, setChallengeScales] = useState(initialRaidsByScale);
  const [challengeDays, setChallengeDays] = useState(initialRaidsByDay);

  const fetchActivityData = useCallback(async () => {
    const response = await fetch(
      `/api/activity/players?username=${player.username}&period=${timePeriod}`,
    );
    const data = await response.json();
    setActivityData(
      data.map((d: number, i: number) => ({ hour: i, count: d })),
    );
  }, [player.username, timePeriod, setActivityData]);

  const fetchChallengeStats = useCallback(async () => {
    const query = {
      party: player.username,
      type: ChallengeType.TOB,
      startTime: `ge${startOfTimePeriod(timePeriod).getTime()}`,
    };

    const [statuses, scales, days]: [
      ChallengeStatsResponse,
      ChallengeStatsResponse,
      ChallengeStatsResponse,
    ] = await Promise.all([
      fetch(`/api/v1/challenges/stats?${queryString(query)}&group=status`).then(
        (res) => res.json(),
      ),
      fetch(`/api/v1/challenges/stats?${queryString(query)}&group=scale`).then(
        (res) => res.json(),
      ),
      fetch(
        `/api/v1/challenges/stats?${queryString(query)}&group=startTime`,
      ).then((res) => res.json()),
    ]);

    const statusData = Object.entries(statuses ?? {}).flatMap(([s, data]) => {
      const status = parseInt(s, 10) as ChallengeStatus;
      if (status === ChallengeStatus.IN_PROGRESS) {
        return [];
      }

      return { status, count: data['*'].count };
    });

    const byScale = Object.entries(scales ?? {}).flatMap(([s, data]) => {
      const scale = parseInt(s, 10) as number;
      return { scale, count: data['*'].count };
    });

    const byDay = Object.entries(days ?? {}).flatMap(([s, data]) => {
      const date = new Date(s);
      return { date, count: data['*'].count };
    });

    setChallengeStatuses(statusData);
    setChallengeScales(byScale);
    setChallengeDays(byDay);
  }, [
    player.username,
    timePeriod,
    setChallengeStatuses,
    setChallengeScales,
    setChallengeDays,
  ]);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      await Promise.all([fetchActivityData(), fetchChallengeStats()]);
      setLoading(false);
    };
    fetchData();
    const interval = setInterval(fetchData, 15_000);
    return () => clearInterval(interval);
  }, [fetchActivityData, fetchChallengeStats]);

  const regPbs: PbEntry[] = [
    { title: scaleName(1), raidId: null, time: null },
    { title: scaleName(2), raidId: null, time: null },
    { title: scaleName(3), raidId: null, time: null },
    { title: scaleName(4), raidId: null, time: null },
    { title: scaleName(5), raidId: null, time: null },
  ];
  const hmtPbs: PbEntry[] = [
    { title: scaleName(1), raidId: null, time: null },
    { title: scaleName(2), raidId: null, time: null },
    { title: scaleName(3), raidId: null, time: null },
    { title: scaleName(4), raidId: null, time: null },
    { title: scaleName(5), raidId: null, time: null },
  ];

  for (const pb of personalBests) {
    if (pb.type === SplitType.TOB_REG_CHALLENGE) {
      regPbs[pb.scale - 1].time = pb.ticks;
      regPbs[pb.scale - 1].raidId = pb.cid;
    } else if (pb.type === SplitType.TOB_HM_CHALLENGE) {
      hmtPbs[pb.scale - 1].time = pb.ticks;
      hmtPbs[pb.scale - 1].raidId = pb.cid;
    }
  }

  const statuses = challengeStatuses.map((status) => {
    const [name, color] = statusNameAndColor(status.status);
    return { name, count: status.count, color };
  });

  const scales = challengeScales.map((scale) => {
    const [name, color] = scaleNameAndColor(scale.scale);
    return { name, count: scale.count, color };
  });

  const totalRaids = challengeStatuses.reduce(
    (sum, status) => sum + status.count,
    0,
  );

  const heatmap = useMemo(
    () => <CalendarHeatmap data={challengeDays} />,
    [challengeDays],
  );

  return (
    <div className={styles.overviewContent}>
      <Card
        header={{
          title: 'Personal Bests',
          action: (
            <CardLink
              href={`/players/${player.username}/personal-bests`}
              text="View all"
            />
          ),
        }}
      >
        <div className={styles.pbTables}>
          <PbTable title="ToB Regular" pbs={regPbs} />
          <PbTable title="ToB Hard Mode" pbs={hmtPbs} />
        </div>
      </Card>

      <Card
        header={{
          title: 'Activity',
          action: (
            <RadioInput.Group
              name="time-selector"
              className={styles.filters}
              onChange={(value) => setTimePeriod(value as TimePeriod)}
              compact
              joined
            >
              <RadioInput.Option
                value={TimePeriod.DAY.toString()}
                id="time-selector-day"
                label="Day"
                checked={timePeriod === TimePeriod.DAY}
                disabled={loading}
              />
              <RadioInput.Option
                value={TimePeriod.WEEK.toString()}
                id="time-selector-week"
                label="Week"
                checked={timePeriod === TimePeriod.WEEK}
                disabled={loading}
              />
              <RadioInput.Option
                value={TimePeriod.MONTH.toString()}
                id="time-selector-month"
                label="Month"
                checked={timePeriod === TimePeriod.MONTH}
                disabled={loading}
              />
              <RadioInput.Option
                value={TimePeriod.ALL.toString()}
                id="time-selector-all"
                label="All time"
                checked={timePeriod === TimePeriod.ALL}
                disabled={loading}
              />
            </RadioInput.Group>
          ),
        }}
      >
        <div className={styles.activityStats}>
          <div className={styles.activityHeader}>
            <Statistic
              name="Total Raids"
              value={totalRaids}
              width={PLAYER_PAGE_STATISTIC_SIZE}
              height={PLAYER_PAGE_STATISTIC_SIZE}
              simple
            />
          </div>
          {isClient && (
            <>
              <div className={styles.raidCharts}>
                <div className={styles.raidChart}>
                  <h3>
                    <i className="fas fa-flag-checkered" /> By Status
                  </h3>
                  {statuses.length > 0 ? (
                    <PieChart
                      width={PLAYER_PAGE_CHART_SIZE}
                      height={PLAYER_PAGE_CHART_SIZE / 1.5}
                    >
                      <Pie
                        data={statuses}
                        dataKey="count"
                        cx="50%"
                        cy="100%"
                        outerRadius="160%"
                        innerRadius="100%"
                        startAngle={180}
                        endAngle={0}
                        stroke="var(--nav-bg)"
                      >
                        {statuses.map((v, i) => (
                          <Cell key={`cell-${i}`} fill={v.color} />
                        ))}
                      </Pie>
                      <Legend
                        verticalAlign="top"
                        height={36}
                        formatter={(value) => {
                          const item = statuses.find((s) => s.name === value);
                          return (
                            <span className={styles.legendItem}>
                              {value} ({item?.count})
                            </span>
                          );
                        }}
                      />
                    </PieChart>
                  ) : (
                    <div
                      className={styles.noData}
                      style={{
                        width: PLAYER_PAGE_CHART_SIZE,
                        height: PLAYER_PAGE_CHART_SIZE / 1.5,
                      }}
                    >
                      <i className="fas fa-chart-pie" />
                      No raid data available for this time period
                    </div>
                  )}
                </div>
                <div className={styles.raidChart}>
                  <h3>
                    <i className="fas fa-users" /> By Scale
                  </h3>
                  {scales.length > 0 ? (
                    <PieChart
                      width={PLAYER_PAGE_CHART_SIZE}
                      height={PLAYER_PAGE_CHART_SIZE / 1.5}
                    >
                      <Pie
                        data={scales}
                        dataKey="count"
                        cx="50%"
                        cy="100%"
                        outerRadius="160%"
                        innerRadius="100%"
                        startAngle={180}
                        endAngle={0}
                        stroke="var(--nav-bg)"
                      >
                        {scales.map((v, i) => (
                          <Cell key={`cell-${i}`} fill={v.color} />
                        ))}
                      </Pie>
                      <Legend
                        verticalAlign="top"
                        height={36}
                        formatter={(value) => {
                          return (
                            <span className={styles.legendItem}>
                              {value} (
                              {scales.find((s) => s.name === value)?.count})
                            </span>
                          );
                        }}
                      />
                    </PieChart>
                  ) : (
                    <div
                      className={styles.noData}
                      style={{
                        width: PLAYER_PAGE_CHART_SIZE,
                        height: PLAYER_PAGE_CHART_SIZE / 1.5,
                      }}
                    >
                      <i className="fas fa-chart-pie" />
                      No raid data available for this time period
                    </div>
                  )}
                </div>
              </div>
              <ActivityChart
                data={activityData}
                title="Active Hours"
                timeRange={
                  timePeriod === TimePeriod.ALL
                    ? 'All time'
                    : `Last ${
                        timePeriod === TimePeriod.DAY
                          ? '24h'
                          : timePeriod === TimePeriod.WEEK
                            ? '7d'
                            : '30d'
                      }`
                }
                height={120}
                startHour={0}
              />
            </>
          )}
        </div>
      </Card>

      <Card header={{ title: 'Activity Heatmap' }} className={styles.fullWidth}>
        <div className={styles.heatmapContainer}>
          <div className={styles.wrapper}>
            <h3>
              {totalRaids} raid{totalRaids === 1 ? '' : 's'} in the last year
            </h3>
            <div className={styles.heatmapWrapper}>{isClient && heatmap}</div>
          </div>
        </div>
      </Card>
    </div>
  );
}
