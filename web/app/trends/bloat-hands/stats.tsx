import { ChallengeMode } from '@blert/common';

import { BloatHandsResponse } from '@/actions/challenge';
import { getOrdinal } from '@/utils/path-util';

import { BloatHandsFilters, DisplayMode } from './controls';

import styles from './stats.module.scss';

type BloatHandsStatsProps = {
  data: BloatHandsResponse;
  displayMode: DisplayMode;
  filters: BloatHandsFilters;
};

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function buildViewDescription(
  displayMode: DisplayMode,
  filters: BloatHandsFilters,
): string {
  let description = '';

  if (displayMode === 'percentage') {
    description = 'Shows the percentage of total hands spawned on each tile';
  } else {
    description =
      'Shows how many hands spawn on each tile relative to the average (per-tile baseline)';
  }

  if (filters.intraChunkOrder !== undefined) {
    const order = parseInt(filters.intraChunkOrder);
    description += `, specifically for hands that were the ${getOrdinal(order + 1)} to spawn within their 8×8 chunk`;
  }

  description += '.';

  let filterDescription: string | undefined = undefined;

  if (filters.startDate && filters.endDate) {
    filterDescription = `raids from ${formatDate(filters.startDate)} to ${formatDate(filters.endDate)}`;
  } else if (filters.startDate) {
    filterDescription = `raids since ${formatDate(filters.startDate)}`;
  } else if (filters.endDate) {
    filterDescription = `raids up to ${formatDate(filters.endDate)}`;
  }

  if (filters.mode !== undefined) {
    const modeName =
      filters.mode === ChallengeMode.TOB_REGULAR ? 'Regular' : 'Hard';
    filterDescription = `${modeName} Mode ${filterDescription ?? 'raids'}`;
  }

  if (filterDescription) {
    description += ` Analysis is limited to ${filterDescription}.`;
  }

  return description;
}

export default function BloatHandsStats({
  data,
  displayMode,
  filters,
}: BloatHandsStatsProps) {
  const avgHandsPerRaid = data.totalHands / data.totalChallenges;
  const passableTileCount = 256 - 36; // 16x16 grid minus 6x6 impassable area
  const avgHandsPerTile = data.totalHands / passableTileCount;

  const viewDescription = buildViewDescription(displayMode, filters);

  return (
    <div className={styles.stats}>
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Overview</h3>
        <div className={styles.statGrid}>
          <div className={styles.stat}>
            <div className={styles.statValue}>
              {data.totalChallenges.toLocaleString()}
            </div>
            <div className={styles.statLabel}>Raids</div>
          </div>
          <div className={styles.stat}>
            <div className={styles.statValue}>
              {data.totalHands.toLocaleString()}
            </div>
            <div className={styles.statLabel}>Total Hands</div>
          </div>
          <div className={styles.stat}>
            <div className={styles.statValue}>{avgHandsPerRaid.toFixed(1)}</div>
            <div className={styles.statLabel}>Avg per Raid</div>
          </div>
        </div>
      </div>

      {displayMode === 'relative' && (
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Baseline</h3>
          <div className={styles.baselineInfo}>
            <div className={styles.stat}>
              <div className={styles.statValue}>
                {avgHandsPerTile.toFixed(1)}
              </div>
              <div className={styles.statLabel}>Avg per Tile</div>
            </div>
            <div className={styles.baselineDescription}>
              <p>
                Average calculated across {passableTileCount} passable tiles.
                Values above 0% indicate higher-than-average spawn rates.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Current View</h3>
        <div className={styles.viewInfo}>
          <div className={styles.displayModeIndicator}>
            <span className={styles.modeIcon}>
              {displayMode === 'percentage' ? '📊' : '⚖️'}
            </span>
            <span className={styles.modeLabel}>
              {displayMode === 'percentage'
                ? 'Percentage Mode'
                : 'Relative Mode'}
            </span>
          </div>
          <p className={styles.viewDescription}>{viewDescription}</p>
        </div>
      </div>
    </div>
  );
}
