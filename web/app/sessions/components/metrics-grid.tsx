'use client';

import { SessionStatus } from '@blert/common';

import Card from '@/components/card';
import SectionTitle from '@/components/section-title';
import Statistic from '@/components/statistic';
import { challengeTerm } from '@/utils/challenge';
import { ticksToFormattedSeconds } from '@/utils/tick';
import { formatDuration } from '@/utils/time';

import { useSessionContext } from './session-context-provider';

import styles from './metrics-grid.module.scss';

function SkeletonMetrics() {
  return (
    <Card className={styles.metricsGrid}>
      <div className={styles.skeletonHeader}>
        <div className={styles.skeletonTitle} />
      </div>
      <div className={styles.statisticsGrid}>
        {Array.from({ length: 8 }).map((_, index) => (
          <div
            key={index}
            className={styles.skeletonStatistic}
            style={{ animationDelay: `${index * 100}ms` }}
          />
        ))}
      </div>
    </Card>
  );
}

function ErrorState() {
  return (
    <Card className={styles.metricsGrid}>
      <div className={styles.errorState}>
        <div className={styles.errorIcon}>
          <i className="fas fa-exclamation-triangle" />
        </div>
        <span>Failed to load session metrics</span>
      </div>
    </Card>
  );
}

function successRateClass(rate: number): string {
  if (rate >= 80) {
    return styles.successRateHigh;
  }
  if (rate >= 50) {
    return styles.successRateModerate;
  }
  return styles.successRateLow;
}

const STATISTIC_WIDTH = 116;
const STATISTIC_FONT_SIZE = 32;

export default function MetricsGrid() {
  const { session, isInitialLoad } = useSessionContext();

  if (isInitialLoad) {
    return <SkeletonMetrics />;
  }

  if (!session) {
    return <ErrorState />;
  }

  const stats = session.stats;

  const isLive = session.status === SessionStatus.ACTIVE;
  const challengeLabel = challengeTerm(session.challengeType);
  const labelLower = challengeLabel.toLowerCase();

  const sessionDurationMs =
    (isLive ? Date.now() : session.endTime!.getTime()) -
    session.startTime.getTime();
  const avgDeathsPerChallenge = stats.deaths / stats.challenges;

  return (
    <Card className={styles.metricsGrid}>
      <SectionTitle icon="fa-chart-line">Session Overview</SectionTitle>
      <div className={styles.statisticsGrid}>
        <Statistic
          className={styles.statistic}
          name={`Total ${challengeLabel}s`}
          value={stats.challenges}
          width={STATISTIC_WIDTH}
          height={STATISTIC_WIDTH}
          icon="fas fa-list-ol"
          simple
          maxFontSize={STATISTIC_FONT_SIZE}
          tooltip={`Total number of ${challengeLabel.toLowerCase()}s attempted in this session`}
        />

        <Statistic
          className={styles.statistic}
          name="Completions"
          value={stats.completions}
          width={STATISTIC_WIDTH}
          height={STATISTIC_WIDTH}
          icon="fas fa-check-circle"
          simple
          maxFontSize={STATISTIC_FONT_SIZE}
          tooltip={`Successfully completed ${challengeLabel.toLowerCase()}s`}
        />

        <Statistic
          className={styles.statistic}
          name="Success Rate"
          value={`${stats.completionRate.toFixed(1)}%`}
          width={STATISTIC_WIDTH}
          height={STATISTIC_WIDTH}
          icon="fas fa-chart-simple"
          simple
          maxFontSize={STATISTIC_FONT_SIZE}
          valueClassName={successRateClass(stats.completionRate)}
          tooltip={
            `Percentage of ${challengeLabel.toLowerCase()}s completed ` +
            `successfully (${stats.completions}/${stats.challenges})`
          }
        />

        <Statistic
          className={styles.statistic}
          name="Session Time"
          value={formatDuration(sessionDurationMs)}
          width={STATISTIC_WIDTH}
          height={STATISTIC_WIDTH}
          icon="fas fa-hourglass"
          simple
          maxFontSize={STATISTIC_FONT_SIZE}
          tooltip={
            isLive
              ? 'Time elapsed since session started'
              : 'Total duration from start to end'
          }
        />

        <Statistic
          className={styles.statistic}
          name="Total Deaths"
          value={stats.deaths}
          width={STATISTIC_WIDTH}
          height={STATISTIC_WIDTH}
          icon="fas fa-skull"
          simple
          maxFontSize={STATISTIC_FONT_SIZE}
          tooltip={
            `Total deaths across all ${labelLower}s ` +
            `(${avgDeathsPerChallenge.toFixed(1)} average per ${labelLower})`
          }
        />

        {stats.personalBests > 0 && (
          <Statistic
            className={styles.statistic}
            name="New PBs"
            value={stats.personalBests}
            width={STATISTIC_WIDTH}
            height={STATISTIC_WIDTH}
            icon="fas fa-star"
            simple
            maxFontSize={STATISTIC_FONT_SIZE}
            valueClassName={styles.pbAchieved}
            tooltip="Personal best times achieved during this session across the team"
          />
        )}

        <Statistic
          className={styles.statistic}
          name={`Avg ${challengeLabel}`}
          value={
            stats.avgCompletionTicks > 0
              ? ticksToFormattedSeconds(Math.floor(stats.avgCompletionTicks))
              : 'N/A'
          }
          width={STATISTIC_WIDTH}
          height={STATISTIC_WIDTH}
          icon="fas fa-clock"
          simple
          maxFontSize={STATISTIC_FONT_SIZE}
          tooltip={`Average completion time for successful ${challengeLabel.toLowerCase()}s`}
        />

        {stats.minCompletionTicks > 0 && (
          <Statistic
            className={styles.statistic}
            name="Fastest"
            value={ticksToFormattedSeconds(stats.minCompletionTicks)}
            width={STATISTIC_WIDTH}
            height={STATISTIC_WIDTH}
            icon="fas fa-trophy"
            simple
            maxFontSize={STATISTIC_FONT_SIZE}
            valueClassName={styles.fastestTime}
            tooltip={`Best completion time achieved in this session`}
          />
        )}
      </div>
    </Card>
  );
}
