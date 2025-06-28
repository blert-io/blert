'use client';

import {
  ChallengeStatus,
  SplitType,
  Stage,
  splitName,
  stageName,
  stagesForChallenge,
} from '@blert/common';

import Card from '@/components/card';
import SectionTitle from '@/components/section-title';
import {
  challengeTerm,
  relevantSplitsForStage,
  stageTerm,
} from '@/utils/challenge';
import { ticksToFormattedSeconds } from '@/utils/tick';

import { useSessionContext } from './session-context-provider';

import MaidenIcon from '@/svg/maiden.svg';
import BloatIcon from '@/svg/bloat.svg';
import NylocasIcon from '@/svg/nyloking.svg';
import SotetsegIcon from '@/svg/sotetseg.svg';
import XarpusIcon from '@/svg/xarpus.svg';
import VerzikIcon from '@/svg/verzik.svg';

import styles from './stage-stats.module.scss';

interface SplitStatistics {
  type: SplitType;
  main: boolean;
  dataPoints: number;
  minTicks?: number;
  avgTicks?: number;
  maxTicks?: number;
}

interface StageStatistics {
  stageName: string;
  icon: React.ReactNode;
  totalDeaths: number;
  attempts: number;
  completions: number;
  completionRate: number;
  splits: SplitStatistics[];
}

function stageIcon(stage: Stage): React.ReactNode {
  switch (stage) {
    case Stage.TOB_MAIDEN:
      return <MaidenIcon width={20} height={20} />;
    case Stage.TOB_BLOAT:
      return <BloatIcon width={20} height={20} />;
    case Stage.TOB_NYLOCAS:
      return <NylocasIcon width={20} height={20} />;
    case Stage.TOB_SOTETSEG:
      return <SotetsegIcon width={20} height={20} />;
    case Stage.TOB_XARPUS:
      return <XarpusIcon width={20} height={20} />;
    case Stage.TOB_VERZIK:
      return <VerzikIcon width={20} height={20} />;
  }

  if (stage >= Stage.COX_TEKTON && stage <= Stage.COX_OLM) {
    return <i className="fas fa-mountain" />;
  }
  if (stage >= Stage.TOA_APMEKEN && stage <= Stage.TOA_WARDENS) {
    return <i className="fas fa-pyramid" />;
  }

  if (stage >= Stage.COLOSSEUM_WAVE_1 && stage <= Stage.COLOSSEUM_WAVE_12) {
    return stage === Stage.COLOSSEUM_WAVE_12 ? (
      <i className="fas fa-crown" />
    ) : (
      <i className="fas fa-water" />
    );
  }

  return <i className="fas fa-circle" />;
}

function StageStatCard({
  stageStats,
  challengeType,
}: {
  stageStats: StageStatistics;
  challengeType: string;
}) {
  const completionRateClass =
    stageStats.completionRate >= 80
      ? styles.highCompletion
      : stageStats.completionRate >= 50
        ? styles.moderateCompletion
        : styles.lowCompletion;

  const deathRateClass =
    stageStats.totalDeaths === 0
      ? styles.noDeaths
      : stageStats.totalDeaths <= 2
        ? styles.lowDeaths
        : stageStats.totalDeaths <= 5
          ? styles.moderateDeaths
          : styles.highDeaths;

  const mainSplit = stageStats.splits.find((s) => s.main);
  const hasTimingData = mainSplit && mainSplit.dataPoints > 0;

  return (
    <div className={styles.stageCard}>
      <div className={styles.stageHeader}>
        <div className={styles.stageTitle}>
          {stageStats.icon}
          <span>{stageStats.stageName}</span>
        </div>
        <div className={styles.stageMetrics}>
          <span className={styles.attempts}>
            {stageStats.attempts} attempt{stageStats.attempts !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      <div className={styles.stageContent}>
        <div className={styles.primaryStats}>
          <div className={styles.statGroup}>
            <div className={`${styles.stat} ${completionRateClass}`}>
              <i className="fas fa-check-circle" />
              <span className={styles.statValue}>
                {stageStats.completionRate.toFixed(0)}%
              </span>
              <span className={styles.statLabel}>Clears</span>
            </div>

            <div className={`${styles.stat} ${deathRateClass}`}>
              <i className="fas fa-skull" />
              <span className={styles.statValue}>{stageStats.totalDeaths}</span>
              <span className={styles.statLabel}>Deaths</span>
            </div>
          </div>
        </div>

        {hasTimingData && mainSplit && (
          <div className={styles.timingStats}>
            <div className={styles.timeGrid}>
              {mainSplit.minTicks && (
                <div className={styles.timestat}>
                  <span className={styles.timeLabel}>Best</span>
                  <span className={`${styles.timeValue} ${styles.bestTime}`}>
                    {ticksToFormattedSeconds(mainSplit.minTicks)}
                  </span>
                </div>
              )}

              {mainSplit.avgTicks && (
                <div className={styles.timestat}>
                  <span className={styles.timeLabel}>Avg</span>
                  <span className={styles.timeValue}>
                    {ticksToFormattedSeconds(mainSplit.avgTicks)}
                  </span>
                </div>
              )}

              {mainSplit.maxTicks && mainSplit.dataPoints > 1 && (
                <div className={styles.timestat}>
                  <span className={styles.timeLabel}>Worst</span>
                  <span className={`${styles.timeValue} ${styles.worstTime}`}>
                    {ticksToFormattedSeconds(mainSplit.maxTicks)}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {stageStats.splits.length > 1 && hasTimingData && (
          <div className={styles.splitsStats}>
            <div className={styles.splitsHeader}>
              <span className={styles.splitsTitle}>Avg Splits</span>
            </div>
            <div className={styles.splitsGrid}>
              {stageStats.splits
                .filter((split) => split !== mainSplit)
                .map((split) => (
                  <div key={split.type} className={styles.splitStat}>
                    <span className={styles.splitName}>
                      {splitName(split.type, false, true)}
                    </span>
                    <span className={styles.splitTime}>
                      {split.avgTicks
                        ? ticksToFormattedSeconds(split.avgTicks)
                        : '--:--.-'}
                    </span>
                  </div>
                ))}
            </div>
          </div>
        )}

        {stageStats.completions === 0 && (
          <div className={styles.noCompletions}>
            <i className="fas fa-times-circle" />
            <span>No completions</span>
          </div>
        )}
      </div>
    </div>
  );
}

function SkeletonStageCard() {
  return (
    <div className={styles.stageCard}>
      <div className={styles.stageHeader}>
        <div className={styles.stageTitle}>
          <div className={`${styles.skeleton} ${styles.skeletonIcon}`} />
          <div className={`${styles.skeleton} ${styles.skeletonStageTitle}`} />
        </div>
        <div className={`${styles.skeleton} ${styles.skeletonAttempts}`} />
      </div>
      <div className={styles.stageContent}>
        <div className={styles.primaryStats}>
          <div className={styles.statGroup}>
            <div className={styles.stat}>
              <div
                className={`${styles.skeleton} ${styles.skeletonStatValue}`}
              />
              <div
                className={`${styles.skeleton} ${styles.skeletonStatLabel}`}
              />
            </div>
            <div className={styles.stat}>
              <div
                className={`${styles.skeleton} ${styles.skeletonStatValue}`}
              />
              <div
                className={`${styles.skeleton} ${styles.skeletonStatLabel}`}
              />
            </div>
          </div>
        </div>
        <div className={styles.timingStats}>
          <div className={styles.timeGrid}>
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className={styles.timestat}>
                <div
                  className={`${styles.skeleton} ${styles.skeletonTimeLabel}`}
                />
                <div
                  className={`${styles.skeleton} ${styles.skeletonTimeValue}`}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ challengeType }: { challengeType: string }) {
  return (
    <div className={styles.emptyState}>
      <div className={styles.emptyIcon}>
        <i className="fas fa-chart-bar" />
      </div>
      <span>No stage data available for this session</span>
      <p className={styles.emptyHint}>
        Complete some {challengeType.toLowerCase()}s to see stage-by-stage
        performance
      </p>
    </div>
  );
}

export default function StageStats() {
  const { session, isInitialLoad } = useSessionContext();

  if (isInitialLoad) {
    return (
      <Card>
        <SectionTitle icon="fa-chart-bar">Stage Performance</SectionTitle>
        <div className={styles.stagesGrid}>
          {Array.from({ length: 4 }).map((_, index) => (
            <SkeletonStageCard key={index} />
          ))}
        </div>
      </Card>
    );
  }

  if (!session) {
    return (
      <Card>
        <SectionTitle icon="fa-chart-bar">Stage Performance</SectionTitle>
        <div className={styles.errorState}>
          <div className={styles.errorIcon}>
            <i className="fas fa-exclamation-triangle" />
          </div>
          <span>Failed to load stage statistics</span>
        </div>
      </Card>
    );
  }

  const challengeLabel = challengeTerm(session.challengeType);
  const stageLabel = stageTerm(session.challengeType);
  const stages = stagesForChallenge(session.challengeType);

  const stageStatistics: StageStatistics[] = stages.map((stage) => {
    const name = stageName(stage);
    const stageChallenges = session.challenges.filter((c) => c.stage >= stage);

    // The number of times the team completed the stage (includes resets).
    const wipes = stageChallenges.filter(
      (c) => c.stage === stage && c.status === ChallengeStatus.WIPED,
    ).length;
    const completions = stageChallenges.length - wipes;

    const totalDeaths = session.playerStats.reduce(
      (sum, p) => sum + (p.deathsByStage[stage] ?? 0),
      0,
    );

    const attempts = stageChallenges.length;

    const relevantSplits = relevantSplitsForStage(stage, session.challengeMode);

    const splitStatistics: SplitStatistics[] = relevantSplits.map(
      (splitType) => {
        const splitData = stageChallenges
          .map((c) => c.splits[splitType]?.ticks)
          .filter((t): t is number => t !== undefined);

        const minTicks =
          splitData.length > 0 ? Math.min(...splitData) : undefined;
        const maxTicks =
          splitData.length > 0 ? Math.max(...splitData) : undefined;
        const avgTicks =
          splitData.length > 0
            ? Math.floor(
                splitData.reduce((sum, t) => sum + t, 0) / splitData.length,
              )
            : undefined;

        const main = splitType === relevantSplits[0];

        return {
          type: splitType,
          main,
          minTicks,
          avgTicks,
          maxTicks,
          dataPoints: splitData.length,
        };
      },
    );

    return {
      stageName: stageName(stage),
      icon: stageIcon(stage),
      totalDeaths,
      attempts,
      completions,
      completionRate: attempts > 0 ? (completions / attempts) * 100 : 0,
      splits: splitStatistics,
    };
  });

  // Filter to only show stages that have been attempted.
  const visibleStages = stageStatistics.filter((s) => s.attempts > 0);

  if (visibleStages.length === 0) {
    return (
      <Card>
        <SectionTitle icon="fa-chart-bar">
          {stageLabel} Performance
        </SectionTitle>
        <EmptyState challengeType={challengeLabel} />
      </Card>
    );
  }

  return (
    <Card>
      <SectionTitle icon="fa-chart-bar">{stageLabel} Performance</SectionTitle>
      <div className={styles.stagesGrid}>
        {visibleStages.map((stageStats, index) => (
          <StageStatCard
            key={index}
            stageStats={stageStats}
            challengeType={challengeLabel}
          />
        ))}
      </div>
    </Card>
  );
}
