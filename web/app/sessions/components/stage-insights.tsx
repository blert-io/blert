'use client';

import { ChallengeType } from '@blert/common';

import Card from '@/components/card';
import SectionTitle from '@/components/section-title';
import { challengeTerm } from '@/utils/challenge';
import { ticksToFormattedSeconds } from '@/utils/tick';

import { useSessionContext } from './session-context-provider';

import styles from './stage-insights.module.scss';

function StageStatCard({
  title,
  value,
  icon,
  subtitle,
  trend,
}: {
  title: string;
  value: string | number;
  icon: string;
  subtitle?: string;
  trend?: 'up' | 'down' | 'neutral';
}) {
  return (
    <div className={styles.statCard}>
      <div className={styles.statHeader}>
        <i className={`fas ${icon}`} />
        <span className={styles.statTitle}>{title}</span>
      </div>
      <div className={styles.statValue}>
        {value}
        {trend && (
          <i
            className={`fas ${
              trend === 'up'
                ? 'fa-trending-up'
                : trend === 'down'
                  ? 'fa-trending-down'
                  : 'fa-minus'
            }`}
            style={{
              color:
                trend === 'up'
                  ? '#4ade80'
                  : trend === 'down'
                    ? '#f87171'
                    : '#64748b',
            }}
          />
        )}
      </div>
      {subtitle && <div className={styles.statSubtitle}>{subtitle}</div>}
    </div>
  );
}

function TobInsights({ raids }: { raids: any[] }) {
  const completedRaids = raids.filter(
    (r) => r.splits && r.status === 'COMPLETED',
  );

  if (completedRaids.length === 0) {
    return (
      <div className={styles.emptyState}>
        <i className="fas fa-chart-line" />
        <span>No completed raids with splits data</span>
      </div>
    );
  }

  // Calculate average splits
  const avgMaiden =
    completedRaids.reduce((sum, r) => sum + (r.splits?.maiden || 0), 0) /
    completedRaids.length;
  const avgBloat =
    completedRaids.reduce((sum, r) => sum + (r.splits?.bloat || 0), 0) /
    completedRaids.length;
  const avgNylocas =
    completedRaids.reduce((sum, r) => sum + (r.splits?.nylocas || 0), 0) /
    completedRaids.length;
  const avgSotetseg =
    completedRaids.reduce((sum, r) => sum + (r.splits?.sotetseg || 0), 0) /
    completedRaids.length;
  const avgXarpus =
    completedRaids.reduce((sum, r) => sum + (r.splits?.xarpus || 0), 0) /
    completedRaids.length;
  const avgVerzik =
    completedRaids.reduce((sum, r) => sum + (r.splits?.verzik || 0), 0) /
    completedRaids.length;

  const totalDeaths = completedRaids.reduce((sum, r) => sum + r.totalDeaths, 0);
  const completionRate = ((completedRaids.length / raids.length) * 100).toFixed(
    1,
  );

  return (
    <div className={styles.insightsGrid}>
      <div className={styles.statsSection}>
        <h4 className={styles.sectionSubtitle}>
          <i className="fas fa-chart-bar" />
          Room Performance
        </h4>
        <div className={styles.statsGrid}>
          <StageStatCard
            title="Maiden"
            value={ticksToFormattedSeconds(avgMaiden)}
            icon="fa-shield-halved"
            subtitle="Average time"
          />
          <StageStatCard
            title="Bloat"
            value={ticksToFormattedSeconds(avgBloat)}
            icon="fa-bug"
            subtitle="Average time"
          />
          <StageStatCard
            title="Nylocas"
            value={ticksToFormattedSeconds(avgNylocas)}
            icon="fa-spider"
            subtitle="Average time"
          />
          <StageStatCard
            title="Sotetseg"
            value={ticksToFormattedSeconds(avgSotetseg)}
            icon="fa-eye"
            subtitle="Average time"
          />
          <StageStatCard
            title="Xarpus"
            value={ticksToFormattedSeconds(avgXarpus)}
            icon="fa-claw-marks"
            subtitle="Average time"
          />
          <StageStatCard
            title="Verzik"
            value={ticksToFormattedSeconds(avgVerzik)}
            icon="fa-crown"
            subtitle="Average time"
          />
        </div>
      </div>

      <div className={styles.statsSection}>
        <h4 className={styles.sectionSubtitle}>
          <i className="fas fa-trophy" />
          Session Stats
        </h4>
        <div className={styles.statsGrid}>
          <StageStatCard
            title="Completion Rate"
            value={`${completionRate}%`}
            icon="fa-check-circle"
            subtitle={`${completedRaids.length}/${raids.length} raids`}
          />
          <StageStatCard
            title="Total Deaths"
            value={totalDeaths}
            icon="fa-skull"
            subtitle={`${(totalDeaths / completedRaids.length).toFixed(1)} per raid`}
          />
          <StageStatCard
            title="Best Completion"
            value={ticksToFormattedSeconds(
              Math.min(...completedRaids.map((r) => r.challengeTicks)),
            )}
            icon="fa-star"
            subtitle="Fastest time"
          />
        </div>
      </div>
    </div>
  );
}

function GenericInsights({
  challenges,
  challengeType,
}: {
  challenges: any[];
  challengeType: ChallengeType;
}) {
  const completedChallenges = challenges.filter(
    (c) => c.status === 'COMPLETED',
  );
  const isSolo = [ChallengeType.COLOSSEUM, ChallengeType.INFERNO].includes(
    challengeType,
  );
  const challengeLabel = isSolo ? 'runs' : 'raids';

  if (completedChallenges.length === 0) {
    return (
      <div className={styles.emptyState}>
        <i className="fas fa-chart-line" />
        <span>No completed {challengeLabel} to analyze</span>
      </div>
    );
  }

  const completionRate = (
    (completedChallenges.length / challenges.length) *
    100
  ).toFixed(1);
  const avgTime =
    completedChallenges.reduce((sum, c) => sum + c.challengeTicks, 0) /
    completedChallenges.length;
  const totalDeaths = completedChallenges.reduce(
    (sum, c) => sum + c.totalDeaths,
    0,
  );
  const bestTime = Math.min(
    ...completedChallenges.map((c) => c.challengeTicks),
  );

  return (
    <div className={styles.insightsGrid}>
      <div className={styles.statsSection}>
        <h4 className={styles.sectionSubtitle}>
          <i className="fas fa-chart-bar" />
          Performance Overview
        </h4>
        <div className={styles.statsGrid}>
          <StageStatCard
            title="Completion Rate"
            value={`${completionRate}%`}
            icon="fa-check-circle"
            subtitle={`${completedChallenges.length}/${challenges.length} ${challengeLabel}`}
          />
          <StageStatCard
            title="Average Time"
            value={ticksToFormattedSeconds(avgTime)}
            icon="fa-clock"
            subtitle="Per completion"
          />
          <StageStatCard
            title="Best Time"
            value={ticksToFormattedSeconds(bestTime)}
            icon="fa-star"
            subtitle="Personal best"
          />
          <StageStatCard
            title="Total Deaths"
            value={totalDeaths}
            icon="fa-skull"
            subtitle={`${(totalDeaths / completedChallenges.length).toFixed(1)} per ${challengeLabel}`}
          />
        </div>
      </div>
    </div>
  );
}

export default function StageInsights() {
  const { session } = useSessionContext();

  if (!session) {
    return <div className={styles.skeletonHeader} />;
  }

  const challengeLabel = challengeTerm(session.challengeType, true);

  return (
    <Card>
      <SectionTitle icon="fa-chart-line">
        {challengeLabel} Analytics
      </SectionTitle>

      {session.challengeType === ChallengeType.TOB ? (
        <TobInsights raids={session.challenges} />
      ) : (
        <GenericInsights
          challenges={session.challenges}
          challengeType={session.challengeType}
        />
      )}
    </Card>
  );
}
