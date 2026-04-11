'use client';

import {
  challengeName,
  ChallengeStatus,
  ChallengeType,
  stageName,
  stagesForChallenge,
} from '@blert/common';
import Link from 'next/link';
import { useContext, useEffect, useState } from 'react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import {
  getTotalDeathsByStage,
  GroupedAggregationResult,
} from '@/actions/challenge';
import Card from '@/components/card';
import Statistic from '@/components/statistic';
import { DisplayContext } from '@/display';
import { stageTerm } from '@/utils/challenge';

import styles from './style.module.scss';

const STATISTIC_SIZE = 104;

type CompletionStats = {
  total: number;
  completions: number;
  resets: number;
  wipes: number;
};

export type AnalysisLink = {
  href: string;
  title: string;
  description: string;
  icon: React.ReactNode;
};

type ChallengeStatsProps = {
  challenge: ChallengeType;
  analysisLinks?: AnalysisLink[];
};

export default function ChallengeStats({
  challenge,
  analysisLinks = [],
}: ChallengeStatsProps) {
  const display = useContext(DisplayContext);

  const [deathsByStage, setDeathsByStage] = useState<Record<number, number>>(
    {},
  );

  const [wipeStatsByStage, setWipeStatsByStage] = useState<
    Record<number, { wipes: number; reached: number }>
  >({});

  const [completionStats, setCompletionStats] =
    useState<CompletionStats | null>(null);

  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      try {
        const fetches = [
          getTotalDeathsByStage(stagesForChallenge(challenge)).then(
            setDeathsByStage,
          ),
          fetch(`/api/v1/challenges/stats?type=${challenge}&group=status`)
            .then((res) => res.json())
            .then(
              (res: GroupedAggregationResult<{ '*': 'count' }, ['status']>) => {
                const completions =
                  res[ChallengeStatus.COMPLETED]?.['*'].count ?? 0;
                const resets = res[ChallengeStatus.RESET]?.['*'].count ?? 0;
                const wipes = res[ChallengeStatus.WIPED]?.['*'].count ?? 0;
                setCompletionStats({
                  completions,
                  resets,
                  wipes,
                  total: completions + resets + wipes,
                });
              },
            ),
          fetch(`/api/v1/challenges/stats?type=${challenge}&group=stage,status`)
            .then((res) => res.json())
            .then(
              (
                res: GroupedAggregationResult<
                  { '*': 'count' },
                  ['stage', 'status']
                >,
              ) => {
                const attemptsByStage: Record<number, number> = {};
                const wipesByStage: Record<number, number> = {};
                for (const [stageKey, byStatus] of Object.entries(res)) {
                  const stage = Number(stageKey);
                  let total = 0;
                  for (const [statusKey, agg] of Object.entries(byStatus)) {
                    const count = agg['*'].count;
                    total += count;
                    const status = Number(statusKey) as ChallengeStatus;
                    if (status === ChallengeStatus.WIPED) {
                      wipesByStage[stage] = count;
                    }
                  }
                  attemptsByStage[stage] = total;
                }

                const sortedStages = Object.keys(attemptsByStage)
                  .map(Number)
                  .sort((a, b) => a - b);

                const reachedByStage: Record<number, number> = {};
                let reached = 0;
                for (let i = sortedStages.length - 1; i >= 0; i--) {
                  reached += attemptsByStage[sortedStages[i]];
                  reachedByStage[sortedStages[i]] = reached;
                }

                const stats: Record<
                  number,
                  { wipes: number; reached: number }
                > = {};
                for (const stage of sortedStages) {
                  stats[stage] = {
                    wipes: wipesByStage[stage] ?? 0,
                    reached: reachedByStage[stage],
                  };
                }
                setWipeStatsByStage(stats);
              },
            ),
        ];

        await Promise.all(fetches);
      } catch (error) {
        console.error('Error fetching challenge stats:', error);
      } finally {
        setIsLoading(false);
      }
    };

    void fetchData();
  }, [challenge]);

  const deathData = Object.entries(deathsByStage).map(([stage, deaths]) => {
    const n = Number(stage);
    const stats = wipeStatsByStage[n];
    const wipes = stats?.wipes ?? 0;
    const reached = stats?.reached ?? 0;
    return {
      stage: n,
      name: stageName(n, true),
      deaths,
      wipes,
      reached,
      wipeRate: reached > 0 ? (wipes / reached) * 100 : null,
    };
  });

  const hasDeathData =
    deathData.length > 0 && deathData.some((d) => d.deaths > 0);

  return (
    <Card header={{ title: challengeName(challenge) }} className={styles.panel}>
      <div className={styles.content}>
        <div className={styles.statisticsSection}>
          <h3 className={styles.sectionTitle}>
            <i className="fas fa-chart-bar" />
            Overall Statistics
          </h3>
          <div className={styles.challengeStats}>
            {(completionStats !== null && (
              <>
                <Statistic
                  name="Total"
                  value={completionStats.total}
                  height={STATISTIC_SIZE}
                />
                <Statistic
                  name="Completions"
                  value={completionStats.completions}
                  height={STATISTIC_SIZE}
                />
                <Statistic
                  name="Resets"
                  value={completionStats.resets}
                  height={STATISTIC_SIZE}
                />
                <Statistic
                  name="Wipes"
                  value={completionStats.wipes}
                  height={STATISTIC_SIZE}
                />
              </>
            )) || (
              <div
                className={styles.statsLoading}
                style={{ height: STATISTIC_SIZE }}
              >
                <i className="fas fa-spinner fa-spin" />
                Loading statistics...
              </div>
            )}
          </div>
        </div>

        <div className={styles.chartsSection}>
          <h3 className={styles.sectionTitle}>
            <i className="fas fa-skull" />
            Deaths by {stageTerm(challenge, false)}
          </h3>
          <div className={styles.chartContainer}>
            {isLoading ? (
              <div className={styles.chartLoading}>
                <i className="fas fa-spinner fa-spin" />
                <span>Loading death statistics...</span>
              </div>
            ) : hasDeathData ? (
              <ResponsiveContainer width="100%" height={400}>
                <ComposedChart
                  data={deathData}
                  margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="var(--blert-divider-color)"
                  />
                  <defs>
                    <linearGradient
                      id="deathsGradient"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset="0%"
                        stopColor="var(--blert-purple)"
                        stopOpacity={0.9}
                      />
                      <stop
                        offset="100%"
                        stopColor="var(--blert-purple)"
                        stopOpacity={0.3}
                      />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="name"
                    stroke="var(--blert-font-color-secondary)"
                    tick={{ fontSize: display.isCompact() ? 10 : 12 }}
                    tickLine={false}
                    interval={0}
                  />
                  <YAxis
                    yAxisId="deaths"
                    stroke="var(--blert-font-color-secondary)"
                    tick={{ fontSize: 12 }}
                    tickLine={false}
                    label={{
                      value: 'Deaths',
                      angle: -90,
                      position: 'insideLeft',
                      style: {
                        fill: 'var(--blert-font-color-secondary)',
                        fontSize: 12,
                        textAnchor: 'middle',
                      },
                    }}
                  />
                  <YAxis
                    yAxisId="rate"
                    orientation="right"
                    domain={[0, 100]}
                    tickFormatter={(v: number) => `${v}%`}
                    stroke="rgba(var(--blert-red-base), 0.6)"
                    tick={{ fontSize: 12 }}
                    tickLine={false}
                    label={{
                      value: 'Wipe rate',
                      angle: 90,
                      position: 'insideRight',
                      style: {
                        fill: 'rgba(var(--blert-red-base), 0.6)',
                        fontSize: 12,
                        textAnchor: 'middle',
                      },
                    }}
                  />
                  <Tooltip
                    contentStyle={{
                      background: 'var(--blert-surface-dark)',
                      border: 'none',
                      borderRadius: '4px',
                      fontSize: '12px',
                    }}
                    cursor={{ fill: 'var(--blert-divider-color)' }}
                    labelFormatter={(
                      label: string,
                      payload: { payload?: { stage?: number } }[],
                    ) => {
                      // Try to use the stage's full name, but fall back to the
                      // short name if it's not available.
                      const stage = payload[0]?.payload?.stage;
                      if (stage !== undefined) {
                        label = stageName(stage);
                      }
                      return (
                        <span
                          style={{
                            fontWeight: 600,
                            color: 'var(--blert-font-color-secondary)',
                          }}
                        >
                          {label}
                        </span>
                      );
                    }}
                    formatter={(
                      value: number | string | (number | string)[],
                      _name: string,
                      item: {
                        dataKey?: string | number;
                        payload?: { wipes?: number; reached?: number };
                      },
                    ) => {
                      const numeric =
                        typeof value === 'number' ? value : Number(value);
                      if (item.dataKey === 'wipeRate') {
                        if (!Number.isFinite(numeric)) {
                          return [null, null];
                        }
                        const wipes = item.payload?.wipes ?? 0;
                        const reached = item.payload?.reached ?? 0;
                        return [
                          <span
                            key="rate"
                            style={{ color: 'var(--blert-red)' }}
                          >
                            {numeric.toFixed(1)}% wipe rate (
                            {wipes.toLocaleString()} /{' '}
                            {reached.toLocaleString()})
                          </span>,
                          null,
                        ];
                      }
                      return [
                        <span
                          key="deaths"
                          style={{ color: 'var(--blert-font-color-primary)' }}
                        >
                          {numeric.toLocaleString()} death
                          {numeric === 1 ? '' : 's'}
                        </span>,
                        null,
                      ];
                    }}
                  />
                  <Bar
                    yAxisId="deaths"
                    dataKey="deaths"
                    fill="url(#deathsGradient)"
                    radius={[4, 4, 0, 0]}
                  />
                  <Line
                    yAxisId="rate"
                    type="monotone"
                    dataKey="wipeRate"
                    stroke="rgba(var(--blert-red-base), 0.7)"
                    strokeWidth={2}
                    dot={{ fill: 'var(--blert-red)', r: 3 }}
                    activeDot={{ r: 5 }}
                    connectNulls
                    isAnimationActive={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <div className={styles.noDataPlaceholder}>
                <div className={styles.placeholderIcon}>
                  <i className="fas fa-chart-bar" />
                </div>
                <h4>No Death Data Available</h4>
                <p>
                  Death statistics for the {challengeName(challenge)} are not
                  yet available. Data will appear here once players start
                  recording their attempts.
                </p>
              </div>
            )}
          </div>
        </div>

        {analysisLinks.length > 0 && (
          <div className={styles.analysisSection}>
            <h3 className={styles.sectionTitle}>
              <i className="fas fa-chart-line" />
              Analysis Tools
            </h3>
            <div className={styles.navigationLinks}>
              {analysisLinks.map((link, index) => (
                <Link
                  key={index}
                  href={link.href}
                  className={styles.analysisLink}
                >
                  <div className={styles.linkIcon}>{link.icon}</div>
                  <div className={styles.linkContent}>
                    <div className={styles.linkTitle}>{link.title}</div>
                    <div className={styles.linkDescription}>
                      {link.description}
                    </div>
                  </div>
                  <div className={styles.linkArrow}>
                    <i className="fas fa-arrow-right" />
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
