'use client';

import { splitName } from '@blert/common';

import { SessionPlayerStats } from '@/actions/challenge';
import Card from '@/components/card';
import SectionTitle from '@/components/section-title';
import Tooltip from '@/components/tooltip';
import { ticksToFormattedSeconds } from '@/utils/tick';

import { useSessionContext } from './session-context-provider';

import styles from './player-breakdown.module.scss';

const PLAYER_PB_TOOLTIP_ID = 'player-pb-tooltip';

function PlayerPBTooltipRenderer({
  activeAnchor,
}: {
  activeAnchor: HTMLElement | null;
}) {
  if (activeAnchor?.dataset.tooltipType !== 'player-pbs') {
    return null;
  }

  const pbsData = activeAnchor.dataset.tooltipPbsData;
  if (!pbsData) {
    return null;
  }

  const personalBests = JSON.parse(pbsData);

  return (
    <div className={styles.pbTooltipContent}>
      <div className={styles.pbTooltipHeader}>
        <i className="fas fa-star" />
        <span>Personal Bests Achieved</span>
      </div>
      <div className={styles.pbTooltipList}>
        {personalBests.map((pb: any, index: number) => (
          <div key={index} className={styles.pbTooltipItem}>
            <span className={styles.pbTooltipSplit}>
              {splitName(pb.type, true)}
            </span>
            <span className={styles.pbTooltipTime}>
              {ticksToFormattedSeconds(pb.ticks)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PlayerCard({ player }: { player: SessionPlayerStats }) {
  const deathsClass =
    player.deaths === 0
      ? styles.noDeaths
      : player.deaths <= 2
        ? styles.lowDeaths
        : player.deaths <= 5
          ? styles.moderateDeaths
          : styles.highDeaths;

  const pbsClass = player.personalBests.length > 0 ? styles.hasPBs : '';

  const pbsTooltip: Record<string, any> = {};
  if (player.personalBests.length > 0) {
    pbsTooltip['data-tooltip-id'] = PLAYER_PB_TOOLTIP_ID;
    pbsTooltip['data-tooltip-type'] = 'player-pbs';
    pbsTooltip['data-tooltip-pbs-data'] = JSON.stringify(player.personalBests);
  }

  return (
    <div className={styles.playerCard}>
      <div className={styles.playerHeader}>
        <div className={styles.playerTitle}>
          <i className="fas fa-user" />
          <span>{player.username}</span>
        </div>
      </div>

      <div className={styles.playerContent}>
        <div className={styles.playerStats}>
          <div className={styles.statGroup}>
            <div className={`${styles.stat} ${deathsClass}`}>
              <i className="fas fa-skull" />
              <span className={styles.statValue}>{player.deaths}</span>
              <span className={styles.statLabel}>Deaths</span>
            </div>

            <div className={`${styles.stat} ${pbsClass}`} {...pbsTooltip}>
              <i className="fas fa-star" />
              <span className={styles.statValue}>
                {player.personalBests.length}
              </span>
              <span className={styles.statLabel}>PBs</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PlayerSkeleton() {
  return (
    <div className={styles.playerCard}>
      <div className={styles.playerHeader}>
        <div className={styles.playerTitle}>
          <div className={`${styles.skeleton} ${styles.skeletonIcon}`} />
          <div className={`${styles.skeleton} ${styles.skeletonPlayerTitle}`} />
        </div>
        <div className={styles.playerMetrics}>
          <div className={`${styles.skeleton} ${styles.skeletonChallenges}`} />
        </div>
      </div>
      <div className={styles.playerContent}>
        <div className={styles.playerStats}>
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
      </div>
    </div>
  );
}

export default function PlayerBreakdown() {
  const { session, isInitialLoad } = useSessionContext();

  if (isInitialLoad) {
    return (
      <Card className={styles.playerBreakdown}>
        <SectionTitle icon="fa-users">Player Performance</SectionTitle>
        <div className={styles.playersGrid}>
          {[...Array(4)].map((_, i) => (
            <PlayerSkeleton key={i} />
          ))}
        </div>
      </Card>
    );
  }

  if (!session) {
    return (
      <Card className={styles.playerBreakdown}>
        <SectionTitle icon="fa-users">Player Performance</SectionTitle>
        <div className={styles.errorState}>
          <div className={styles.errorIcon}>
            <i className="fas fa-exclamation-triangle" />
          </div>
          <span>Failed to load player data</span>
        </div>
      </Card>
    );
  }

  if (session.playerStats.length === 0) {
    return (
      <Card className={styles.playerBreakdown}>
        <SectionTitle icon="fa-users">Player Performance</SectionTitle>
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>
            <i className="fas fa-user" />
          </div>
          <span>No player data available</span>
          <p className={styles.emptyHint}>
            Complete some challenges to see individual player performance
          </p>
        </div>
      </Card>
    );
  }

  return (
    <Card className={styles.playerBreakdown}>
      <SectionTitle icon="fa-users">Player Performance</SectionTitle>

      <div className={styles.playersGrid}>
        {session.playerStats.map((player) => (
          <PlayerCard key={player.username} player={player} />
        ))}
      </div>

      <Tooltip
        tooltipId={PLAYER_PB_TOOLTIP_ID}
        render={PlayerPBTooltipRenderer}
      />
    </Card>
  );
}
