'use client';

import { challengeName, ChallengeStatus, ChallengeType } from '@blert/common';
import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Pie,
  PieChart,
  Cell,
  Legend,
  LabelList,
} from 'recharts';

import type { GroupedAggregationResult } from '@/actions/challenge';
import Card from '@/components/card';
import Statistic from '@/components/statistic';
import { useClientOnly } from '@/hooks/client-only';
import { challengeLogo } from '@/logo';
import { scaleNameAndColor, statusNameAndColor } from '@/utils/challenge';
import { ticksToFormattedDuration } from '@/utils/tick';
import { formatDuration } from '@/utils/time';
import { queryString } from '@/utils/url';

import { parseMostActiveTeam, parseSessionStats } from './query';

import styles from './activity-dashboard.module.scss';

type ChartValue<T> = {
  key: T;
  value: number;
};

type ExtendedChartValue<T> = ChartValue<T> & {
  color: string;
  name: string;
};

type TodaysStats = {
  '*': { count: number };
  challengeTicks: { sum: number };
} | null;

export type SessionStats = {
  total: number;
  active: number;
  avgLengthSeconds: number;
  avgChallenges: number;
};

export type MostActiveTeam = {
  party: string[];
  sessions: number;
  maxDurationSeconds: number;
  avgDurationSeconds: number;
};

type ActivityDashboardProps = {
  challengeType: ChallengeType;
  initialDailyStats: TodaysStats;
  initialMostActiveTeam: MostActiveTeam | null;
  initialPlayerData: ChartValue<string>[];
  initialScaleData: ChartValue<number>[];
  initialSessionStats: SessionStats;
  initialStatusData: ChartValue<ChallengeStatus>[];
};

function SectionTitle({
  icon,
  children,
}: {
  icon: string;
  children: React.ReactNode;
}) {
  return (
    <h3 className={styles.sectionTitle}>
      <i className={`fas ${icon}`} />
      {children}
    </h3>
  );
}

function EmptyPlaceholder({
  message,
  icon = 'fa-chart-bar',
}: {
  message: string | string[];
  icon?: string;
}) {
  const messages = Array.isArray(message) ? message : [message];
  const [index] = useState(Math.floor(Math.random() * messages.length));

  return (
    <div className={styles.emptyPlaceholder}>
      <div className={styles.placeholderIcon}>
        <i className={`fas ${icon}`} />
      </div>
      <p>{messages[index]}</p>
    </div>
  );
}

function PieChartSkeleton({ title }: { title: string }) {
  return (
    <div className={styles.pieChartContainer}>
      <h4 className={styles.chartTitle}>{title}</h4>
      <div className={styles.pieChartSkeleton}>
        <div className={styles.skeletonLegend}>
          <div className={styles.skeletonLegendItem}></div>
          <div className={styles.skeletonLegendItem}></div>
          <div className={styles.skeletonLegendItem}></div>
        </div>
        <div className={styles.skeletonCircle}></div>
      </div>
    </div>
  );
}

function BarChartSkeleton() {
  return (
    <div className={styles.barChartSkeleton}>
      {[...Array<undefined>(8)].map((_, i) => (
        <div key={i} className={styles.skeletonBarRow}>
          <div className={styles.skeletonLabel}></div>
          <div
            className={styles.skeletonBar}
            style={{ width: `${85 - i * 5}%` }}
          ></div>
        </div>
      ))}
    </div>
  );
}

function PieChartComponent({
  data,
  title,
  isLoading = false,
}: {
  data: ExtendedChartValue<any>[];
  title: string;
  isLoading?: boolean;
}) {
  if (isLoading) {
    return <PieChartSkeleton title={title} />;
  }

  if (data.length === 0) {
    return <EmptyPlaceholder message="Nothing recorded yet today." />;
  }

  return (
    <div className={styles.pieChartContainer}>
      <h4 className={styles.chartTitle}>{title}</h4>
      <PieChart width={200} height={130}>
        <Pie
          data={data}
          dataKey="value"
          cx="50%"
          cy="100%"
          outerRadius="160%"
          innerRadius="100%"
          startAngle={180}
          endAngle={0}
          stroke="var(--nav-bg)"
        >
          {data.map((v, i) => (
            <Cell key={`cell-${i}`} fill={v.color} />
          ))}
        </Pie>
        <Legend
          verticalAlign="top"
          height={30}
          formatter={(value) => (
            <span className={styles.legendItem}>
              {value} ({data.find((s) => s.name === value)?.value})
            </span>
          )}
        />
      </PieChart>
    </div>
  );
}

const STATISTIC_WIDTH = 108;
const STATISTIC_FONT_SIZE = 32;

const REFRESH_INTERVAL = 30_000;

const EMPTY_PLAYERS_MESSAGES = [
  'No recent player activity to show yet.',
  'Current meta: avoiding the {challenge} entirely.',
  'Blert is standing by. Players, less so.',
  'Looks like everyone logged out.',
  'The {challenge} waits patiently for challengers.',
  "Zero recorded activity. So technically, everyone's tied for first.",
  'The leaderboard is feeling rather empty today.',
];

type GroupedCountResponse = Record<string, { '*': { count: number } }>;

async function fetchJsonOrNull<T>(
  input: RequestInfo,
  init?: RequestInit,
): Promise<T | null> {
  try {
    const response = await fetch(input, init);
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

function toChartValues<T = string>(
  response: GroupedCountResponse | null | undefined,
  keyParser: (key: string) => T = (key) => key as T,
): ChartValue<T>[] {
  if (!response) {
    return [];
  }

  return Object.entries(response)
    .filter(([, value]) => typeof value?.['*']?.count === 'number')
    .map(([key, value]) => ({
      key: keyParser(key),
      value: value['*'].count,
    }));
}

export default function ActivityDashboard({
  challengeType,
  initialDailyStats,
  initialMostActiveTeam = null,
  initialPlayerData = [],
  initialScaleData = [],
  initialSessionStats,
  initialStatusData = [],
}: ActivityDashboardProps) {
  const isClient = useClientOnly();
  const [isLoading, setIsLoading] = useState(false);

  const [dailyStats, setDailyStats] = useState(initialDailyStats);
  const [scaleData, setScaleData] = useState(initialScaleData);
  const [statusData, setStatusData] = useState(initialStatusData);
  const [playerData, setPlayerData] = useState(initialPlayerData);
  const [sessionStats, setSessionStats] = useState(initialSessionStats);
  const [mostActiveTeam, setMostActiveTeam] = useState(initialMostActiveTeam);

  const isSolo =
    challengeType === ChallengeType.COLOSSEUM ||
    challengeType === ChallengeType.INFERNO ||
    challengeType === ChallengeType.MOKHAIOTL;

  const fetchTimeout = useRef<number | null>(null);

  useEffect(() => {
    let isMounted = true;

    const fetchData = async () => {
      fetchTimeout.current = null;

      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);

      const filterParams = {
        type: challengeType,
        startTime: `>=${today.getTime()}`,
      };

      const challengeParams = {
        ...filterParams,
        aggregate: 'challengeTicks:sum',
      };

      const challengePromise = fetchJsonOrNull<TodaysStats>(
        `/api/v1/challenges/stats?${queryString(challengeParams)}`,
      );

      const statusParams = {
        ...filterParams,
        status: [
          ChallengeStatus.COMPLETED,
          ChallengeStatus.RESET,
          ChallengeStatus.WIPED,
        ],
        group: 'status',
      };
      const statusPromise = fetchJsonOrNull<GroupedCountResponse>(
        `/api/v1/challenges/stats?${queryString(statusParams)}`,
      );

      const playerParams = {
        ...filterParams,
        group: 'username',
        limit: 10,
        sort: '-count',
      };
      const playerPromise = fetchJsonOrNull<GroupedCountResponse>(
        `/api/v1/challenges/stats?${queryString(playerParams)}`,
      );

      const sessionParams = {
        ...filterParams,
        aggregate: ['duration:avg', 'challenges:sum'],
        group: 'status',
      };
      const sessionPromise = fetchJsonOrNull<
        Record<
          string,
          {
            '*': { count: number };
            duration: { avg: number };
            challenges: { sum: number };
          }
        >
      >(`/api/v1/sessions/stats?${queryString(sessionParams, false)}`);

      const teamParams = {
        ...filterParams,
        group: 'party',
        aggregate: 'duration:max,sum',
        sort: '-duration:sum',
        limit: 1,
      };
      const teamPromise = fetchJsonOrNull<
        GroupedAggregationResult<
          {
            '*': 'count';
            duration: ('max' | 'sum')[];
          },
          'party'
        >
      >(`/api/v1/sessions/stats?${queryString(teamParams)}`);

      const scalePromise = isSolo
        ? Promise.resolve<GroupedCountResponse | null>(null)
        : fetchJsonOrNull<GroupedCountResponse>(
            `/api/v1/challenges/stats?${queryString({
              ...filterParams,
              group: 'scale',
            })}`,
          );

      try {
        const [
          challengeResponse,
          statusResponse,
          playerResponse,
          sessionResponse,
          teamResponse,
          scaleResponse,
        ] = await Promise.all([
          challengePromise,
          statusPromise,
          playerPromise,
          sessionPromise,
          teamPromise,
          scalePromise,
        ]);

        if (!isMounted) {
          return;
        }

        setDailyStats(challengeResponse);
        setStatusData(toChartValues<number>(statusResponse, parseInt));

        setPlayerData(
          toChartValues(playerResponse).toSorted((a, b) => {
            if (a.value === b.value) {
              return a.key.localeCompare(b.key);
            }
            return b.value - a.value;
          }),
        );

        setSessionStats(parseSessionStats(sessionResponse));
        setMostActiveTeam(parseMostActiveTeam(teamResponse));

        if (!isSolo) {
          setScaleData(toChartValues<number>(scaleResponse, parseInt));
        }
      } catch (error) {
        console.error('ActivityDashboard failed to refresh', error);
      } finally {
        if (isMounted) {
          setIsLoading(false);
          fetchTimeout.current = window.setTimeout(
            () => void fetchData(),
            REFRESH_INTERVAL,
          );
        }
      }
    };

    void fetchData();

    return () => {
      isMounted = false;
      if (fetchTimeout.current !== null) {
        window.clearTimeout(fetchTimeout.current);
      }
    };
  }, [challengeType, isSolo]);

  const statuses = statusData.map((v) => {
    const statusEntry = statusNameAndColor(v.key);
    let name = statusEntry[0];
    const color = statusEntry[1];
    if (v.key === ChallengeStatus.COMPLETED) {
      name = 'Complete';
    }
    return { name, color, ...v };
  });

  const scales = scaleData.map((v) => {
    const [name, color] = scaleNameAndColor(v.key);
    return { name, color, ...v };
  });

  return (
    <div className={styles.dashboard}>
      <Card className={styles.logoCard} primary>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <Image
            src={challengeLogo(challengeType)}
            alt={challengeName(challengeType)}
            height={100}
            width={160}
            style={{ objectFit: 'contain' }}
          />
        </div>
      </Card>

      <Card className={styles.statisticCard}>
        <SectionTitle icon="fa-chart-line">Today’s Activity</SectionTitle>
        <div className={styles.cardContent}>
          <div className={styles.statisticsGrid}>
            <Statistic
              className={styles.statistic}
              name={isSolo ? 'Runs' : 'Raids'}
              value={dailyStats?.['*'].count ?? 0}
              width={STATISTIC_WIDTH}
              height={STATISTIC_WIDTH}
              icon="fas fa-running"
              simple
              maxFontSize={STATISTIC_FONT_SIZE}
            />
            <Statistic
              className={styles.statistic}
              name="Time Played"
              value={
                dailyStats
                  ? ticksToFormattedDuration(dailyStats?.challengeTicks.sum)
                  : '0m'
              }
              width={STATISTIC_WIDTH}
              height={STATISTIC_WIDTH}
              icon="fas fa-clock"
              simple
              maxFontSize={STATISTIC_FONT_SIZE}
            />
            <Statistic
              className={styles.statistic}
              name="Sessions"
              value={sessionStats.total}
              width={STATISTIC_WIDTH}
              height={STATISTIC_WIDTH}
              icon="fas fa-users"
              simple
              maxFontSize={STATISTIC_FONT_SIZE}
            />
            <Statistic
              className={styles.statistic}
              name="Active Now"
              value={sessionStats.active}
              width={STATISTIC_WIDTH}
              height={STATISTIC_WIDTH}
              icon="fas fa-circle"
              simple
              maxFontSize={STATISTIC_FONT_SIZE}
            />
            <Statistic
              className={styles.statistic}
              name="Avg Length"
              value={formatDuration(sessionStats.avgLengthSeconds * 1000)}
              width={STATISTIC_WIDTH}
              height={STATISTIC_WIDTH}
              icon="fas fa-hourglass"
              simple
              maxFontSize={STATISTIC_FONT_SIZE}
            />
            <Statistic
              className={styles.statistic}
              name={isSolo ? 'Runs/Session' : 'Raids/Session'}
              value={sessionStats.avgChallenges.toFixed(1)}
              width={STATISTIC_WIDTH}
              height={STATISTIC_WIDTH}
              icon="fas fa-chart-line"
              simple
              maxFontSize={STATISTIC_FONT_SIZE}
            />
          </div>
        </div>
      </Card>

      <Card>
        <SectionTitle icon="fa-chart-pie">
          Today’s {isSolo ? 'Runs' : 'Raids'}
        </SectionTitle>
        <div className={styles.chartsGrid}>
          {!isSolo && (
            <PieChartComponent
              data={scales}
              title="By Scale"
              isLoading={isLoading || !isClient}
            />
          )}
          <PieChartComponent
            data={statuses}
            title="By Status"
            isLoading={isLoading || !isClient}
          />
        </div>
      </Card>

      <Card className={styles.playersCard}>
        <SectionTitle icon="fa-crown">Most Active Players</SectionTitle>
        {isLoading || !isClient ? (
          <BarChartSkeleton />
        ) : playerData.length > 0 ? (
          <ResponsiveContainer width="100%" height={400}>
            <BarChart data={playerData} layout="vertical">
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="rgba(255, 255, 255, 0.1)"
              />
              <XAxis
                type="number"
                tick={{ fill: 'var(--blert-text-color)', fontSize: 12 }}
                axisLine={{ stroke: 'rgba(255, 255, 255, 0.2)' }}
                tickLine={{ stroke: 'rgba(255, 255, 255, 0.2)' }}
                allowDecimals={false}
                domain={[0, 'dataMax']}
              />
              <YAxis
                dataKey="key"
                type="category"
                width={110}
                tick={{ fill: 'var(--blert-text-color)', fontSize: 12 }}
                axisLine={{ stroke: 'rgba(255, 255, 255, 0.2)' }}
                tickLine={{ stroke: 'rgba(255, 255, 255, 0.2)' }}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'var(--panel-bg)',
                  border: '1px solid var(--nav-bg-lightened)',
                  borderRadius: '6px',
                  color: 'var(--blert-text-color)',
                  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
                }}
                cursor={{ fill: 'rgba(139, 92, 246, 0.1)' }}
                labelFormatter={(label: string) => {
                  return (
                    <span
                      style={{
                        fontWeight: 600,
                        color: 'var(--font-color-nav)',
                      }}
                    >
                      {label}
                    </span>
                  );
                }}
                formatter={(value: number) => [
                  <span
                    key="challenges"
                    style={{ color: 'var(--blert-text-color)' }}
                  >
                    {value.toLocaleString()} raid{value === 1 ? '' : 's'}
                  </span>,
                ]}
              />
              <Bar
                dataKey="value"
                fill="url(#barGradient)"
                radius={[0, 4, 4, 0]}
              >
                <LabelList dataKey="value" position="insideRight" fill="#fff" />
              </Bar>
              <defs>
                <linearGradient id="barGradient" x1="1" y1="0" x2="0" y2="0">
                  <stop offset="0%" stopColor="#62429b" stopOpacity={0.9} />
                  <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.8} />
                </linearGradient>
              </defs>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <EmptyPlaceholder
            message={EMPTY_PLAYERS_MESSAGES.map((m) =>
              m.replace('{challenge}', challengeName(challengeType)),
            )}
            icon="fa-user"
          />
        )}
      </Card>

      <Card>
        <SectionTitle icon="fa-trophy">Most Active Team</SectionTitle>
        {mostActiveTeam ? (
          <div className={styles.activeTeamCard}>
            <div className={styles.teamInfo}>
              <h4 className={styles.teamName}>
                {mostActiveTeam.party.join(', ')}
              </h4>
              <div className={styles.teamStats}>
                <span className={styles.stat}>
                  <i className="fas fa-trophy" />
                  {mostActiveTeam.sessions} session
                  {mostActiveTeam.sessions === 1 ? '' : 's'} today
                </span>
                <span className={styles.stat}>
                  <i className="fas fa-clock" />
                  {formatDuration(
                    mostActiveTeam.maxDurationSeconds * 1000,
                  )}{' '}
                  longest
                </span>
                <span className={styles.stat}>
                  <i className="fas fa-hourglass" />
                  {formatDuration(
                    mostActiveTeam.avgDurationSeconds * 1000,
                  )}{' '}
                  average
                </span>
              </div>
            </div>
            <div className={styles.teamMedal}>
              <i className="fas fa-medal" />
            </div>
          </div>
        ) : (
          <EmptyPlaceholder
            message="No team activity data available yet."
            icon="fa-users"
          />
        )}
      </Card>

      <Card>
        <SectionTitle icon="fa-chart-line">Analysis Tools</SectionTitle>
        <div className={styles.analysisLinks}>
          <Link href="/trends" className={styles.analysisLink}>
            <div className={styles.linkIcon}>
              <i className="fas fa-chart-pie" />
            </div>
            <div className={styles.linkContent}>
              <div className={styles.linkTitle}>Data Trends</div>
              <div className={styles.linkDescription}>
                Community performance insights
              </div>
            </div>
            <div className={styles.linkArrow}>
              <i className="fas fa-arrow-right" />
            </div>
          </Link>
        </div>
      </Card>
    </div>
  );
}
