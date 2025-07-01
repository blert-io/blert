'use client';

import { ChallengeStatus, ChallengeType, SplitType } from '@blert/common';
import Link from 'next/link';
import { Cell, Legend, Pie, PieChart } from 'recharts';
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';

import { ChallengePartner } from '@/actions/challenge';
import ActivityChart from '@/components/activity-chart';
import Card, { CardLink } from '@/components/card';
import RadioInput from '@/components/radio-input';
import Tooltip from '@/components/tooltip';
import Statistic from '@/components/statistic';
import { useClientOnly } from '@/hooks/client-only';
import { scaleNameAndColor, statusNameAndColor } from '@/utils/challenge';
import { ticksToFormattedSeconds } from '@/utils/tick';
import { challengeUrl, playerUrl, queryString } from '@/utils/url';

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

const HEATMAP_TOOLTIP_ID = 'calendar-heatmap-tooltip';

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
  topPartners: ChallengePartner[];
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
  const heatmapRef = useRef<HTMLDivElement>(null);

  // Use 8 as the minimum count so that low-activity players don't have a
  // completely bright heatmap.
  const maxCount = Math.max(...data.map((d) => d.count), 8);

  const { weeks, monthLabels } = useMemo(() => {
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
          Date.UTC(
            date.getUTCFullYear(),
            date.getUTCMonth(),
            date.getUTCDate(),
          ),
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

    return { weeks, monthLabels };
  }, [data]);

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
                  data-tooltip-id={HEATMAP_TOOLTIP_ID}
                  data-tooltip-date={day ? formatDate(day.date) : undefined}
                  data-tooltip-count={day ? day.count.toString() : undefined}
                  data-tooltip-missing-data={day ? 'false' : 'true'}
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
      <Tooltip
        clickable
        tooltipId={HEATMAP_TOOLTIP_ID}
        render={HeatmapTooltipRenderer}
      />
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

function formatDate(date: Date): string {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  ).toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function HeatmapTooltipRenderer({
  activeAnchor,
}: {
  activeAnchor: HTMLElement | null;
}) {
  if (!activeAnchor) {
    return null;
  }

  const dateStr = activeAnchor.dataset.tooltipDate;
  const countStr = activeAnchor.dataset.tooltipCount;
  const isMissingData = activeAnchor.dataset.tooltipMissingData === 'true';

  if (isMissingData) {
    return (
      <div className={styles.heatmapTooltip}>
        <div className={styles.missingData}>
          <i className="fas fa-exclamation-triangle" />
          <span>Missing data</span>
        </div>
      </div>
    );
  }

  if (!dateStr || !countStr) {
    return null;
  }

  const count = parseInt(countStr, 10);

  return (
    <div className={styles.heatmapTooltip}>
      <div className={styles.date}>{dateStr}</div>
      <div className={styles.challengeCount}>
        <i className="fas fa-shield-alt" />
        <span>
          {count} challenge{count === 1 ? '' : 's'}
        </span>
      </div>
    </div>
  );
}

export default function PlayerOverviewContent({
  personalBests,
  initialRaidStatuses,
  initialRaidsByScale,
  initialRaidsByDay,
  topPartners,
}: PlayerOverviewContentProps) {
  const isClient = useClientOnly();
  const player = usePlayer();

  const [timePeriod, setTimePeriod] = useState(TimePeriod.ALL);
  const [loading, setLoading] = useState(false);
  const challengesLastYear = useMemo(
    () => initialRaidsByDay.reduce((acc, { count }) => acc + count, 0),
    [initialRaidsByDay],
  );

  const [activityData, setActivityData] = useState<
    Array<{ hour: number; count: number }>
  >([]);
  const [startHour, setStartHour] = useState(0);

  const [challengeStatuses, setChallengeStatuses] =
    useState(initialRaidStatuses);
  const [challengeScales, setChallengeScales] = useState(initialRaidsByScale);

  const fetchActivityData = useCallback(async () => {
    const response = await fetch(
      `/api/activity/players?username=${player.username}&period=${timePeriod}`,
    );
    const data = await response.json();

    const now = new Date();
    const offset = -now.getTimezoneOffset() / 60;

    // Calculate the UTC hour that corresponds to local midnight.
    const utcMidnight = (24 + offset) % 24;

    const shiftedData = [...data];
    if (offset !== 0) {
      // Shift the array by the timezone offset.
      // For negative offsets (west of UTC), we need to rotate right by
      // `|offset|` hours.
      // For positive offsets (east of UTC), we need to rotate left by `offset`
      // hours.
      const shift = offset > 0 ? offset : 24 + offset;
      const rotated = [
        ...shiftedData.slice(-shift),
        ...shiftedData.slice(0, -shift),
      ];
      shiftedData.splice(0, shiftedData.length, ...rotated);
    }

    setActivityData(
      shiftedData.map((count: number, i: number) => ({ hour: i, count })),
    );
    setStartHour(-utcMidnight);
  }, [player.username, timePeriod, setActivityData]);

  const fetchChallengeStats = useCallback(async () => {
    const query = {
      party: player.username,
      type: ChallengeType.TOB,
      startTime: `ge${startOfTimePeriod(timePeriod).getTime()}`,
    };

    const [statuses, scales]: [ChallengeStatsResponse, ChallengeStatsResponse] =
      await Promise.all([
        fetch(
          `/api/v1/challenges/stats?${queryString(query)}&group=status`,
        ).then((res) => res.json()),
        fetch(
          `/api/v1/challenges/stats?${queryString(query)}&group=scale`,
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

    setChallengeStatuses(statusData);
    setChallengeScales(byScale);
  }, [player.username, timePeriod, setChallengeStatuses, setChallengeScales]);

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

  const totalChallenges = challengeStatuses.reduce(
    (sum, status) => sum + status.count,
    0,
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
          title: 'Top Partners',
          action:
            topPartners.length > 0 ? (
              <CardLink
                href={`/network?focus=${encodeURIComponent(player.username)}`}
                text="View all"
              />
            ) : undefined,
        }}
      >
        <div className={styles.partnersSection}>
          {topPartners.length > 0 ? (
            <div className={styles.partnersList}>
              {topPartners.map((partner) => (
                <Link
                  key={partner.username}
                  href={playerUrl(partner.username)}
                  className={styles.partner}
                >
                  <div className={styles.partnerInfo}>
                    <div className={styles.partnerName}>{partner.username}</div>
                    <div className={styles.partnerMeta}>
                      <div className={styles.challengeCount}>
                        <i className="fas fa-shield-alt" />
                        <span>
                          {partner.challengesTogether.toLocaleString()} raid
                          {partner.challengesTogether === 1 ? '' : 's'}
                        </span>
                      </div>
                    </div>
                  </div>
                  <i className={`fas fa-chevron-right ${styles.arrow}`} />
                </Link>
              ))}
            </div>
          ) : (
            <div className={styles.noPartners}>
              <i className="fas fa-users" />
              <p>No recent partners found</p>
            </div>
          )}
        </div>
      </Card>

      <Card
        className={styles.activityCard}
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
              value={totalChallenges}
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
                        height={48}
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
                        height={48}
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
                startHour={startHour}
              />
            </>
          )}
        </div>
      </Card>

      <Card header={{ title: 'Activity Heatmap' }} className={styles.fullWidth}>
        <div className={styles.heatmapContainer}>
          <div className={styles.wrapper}>
            <h3>
              {challengesLastYear} challenge
              {challengesLastYear === 1 ? '' : 's'} recorded in the last year
            </h3>
            <div className={styles.heatmapWrapper}>
              {isClient && <CalendarHeatmap data={initialRaidsByDay} />}
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
