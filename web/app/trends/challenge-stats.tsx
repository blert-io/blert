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
  BarChart,
  CartesianGrid,
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

  const deathData = Object.entries(deathsByStage).map(([stage, deaths]) => ({
    stage: Number(stage),
    name: stageName(Number(stage), true),
    deaths,
  }));

  const hasDeathData =
    deathData.length > 0 && deathData.some((d) => d.deaths > 0);

  return (
    <Card header={{ title: challengeName(challenge) }} className={styles.panel}>
      <div className={styles.content}>
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
            Deaths by {challenge === ChallengeType.TOB ? 'Room' : 'Stage'}
          </h3>
          <div className={styles.chartContainer}>
            {isLoading ? (
              <div className={styles.chartLoading}>
                <i className="fas fa-spinner fa-spin" />
                <span>Loading death statistics...</span>
              </div>
            ) : hasDeathData ? (
              <ResponsiveContainer width="100%" height={400}>
                <BarChart
                  data={deathData}
                  margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="rgba(255, 255, 255, 0.1)"
                  />
                  <Bar
                    dataKey="deaths"
                    fill="url(#deathsGradient)"
                    radius={[4, 4, 0, 0]}
                  />
                  <defs>
                    <linearGradient
                      id="deathsGradient"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.9} />
                      <stop
                        offset="100%"
                        stopColor="#62429b"
                        stopOpacity={0.8}
                      />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="name"
                    tick={{
                      fill: 'var(--blert-font-color-primary)',
                      fontSize: display.isCompact() ? 12 : 14,
                    }}
                    axisLine={{ stroke: 'rgba(255, 255, 255, 0.2)' }}
                    tickLine={{ stroke: 'rgba(255, 255, 255, 0.2)' }}
                    interval={0}
                  />
                  <YAxis
                    tick={{
                      fill: 'var(--blert-font-color-primary)',
                      fontSize: 12,
                    }}
                    axisLine={{ stroke: 'rgba(255, 255, 255, 0.2)' }}
                    tickLine={{ stroke: 'rgba(255, 255, 255, 0.2)' }}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'var(--blert-panel-background-color)',
                      border: '1px solid var(--blert-surface-light)',
                      borderRadius: '6px',
                      color: 'var(--blert-font-color-primary)',
                      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
                    }}
                    cursor={{ fill: 'rgba(139, 92, 246, 0.1)' }}
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
                    formatter={(value: number) => [
                      <span
                        key="deaths"
                        style={{ color: 'var(--blert-font-color-primary)' }}
                      >
                        {value.toLocaleString()} death{value === 1 ? '' : 's'}
                      </span>,
                    ]}
                  />
                </BarChart>
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
      </div>
    </Card>
  );
}
