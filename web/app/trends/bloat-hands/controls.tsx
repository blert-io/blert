import { ChallengeMode } from '@blert/common';
import { Dispatch, SetStateAction } from 'react';

import DatePicker from '@/components/date-picker';

import styles from './controls.module.scss';

export type DisplayMode = 'percentage' | 'relative';

export type BloatHandsFilters = {
  mode?: ChallengeMode;
  party?: string;
  wave?: string;
  chunk?: string;
  intraChunkOrder?: string;
  startDate: Date | null;
  endDate: Date | null;
};

type BloatHandsControlsProps = {
  filters: BloatHandsFilters;
  setFilters: Dispatch<SetStateAction<BloatHandsFilters>>;
  displayMode: DisplayMode;
  onDisplayModeChange: (mode: DisplayMode) => void;
  loading?: boolean;
};

export default function BloatHandsControls({
  filters,
  setFilters,
  displayMode,
  onDisplayModeChange,
  loading = false,
}: BloatHandsControlsProps) {
  const today = new Date();

  return (
    <div className={styles.controls}>
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Display Mode</h3>
        <div className={styles.displayModeSelector}>
          <div className={styles.filterGroup}>
            <label htmlFor="display-mode">Data Display</label>
            <select
              id="display-mode"
              className={styles.filterSelect}
              value={displayMode}
              onChange={(e) =>
                onDisplayModeChange(e.target.value as DisplayMode)
              }
              disabled={loading}
            >
              <option value="percentage">Percentage of Total Hands</option>
              <option value="relative">Relative to Average</option>
            </select>
          </div>
        </div>
      </div>
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Filters</h3>
        <div className={styles.filterGrid}>
          <div className={styles.filterGroup}>
            <label htmlFor="mode-filter">Raid Mode</label>
            <select
              id="mode-filter"
              className={styles.filterSelect}
              value={filters.mode ?? ''}
              onChange={(e) =>
                setFilters({
                  ...filters,
                  mode:
                    e.target.value === ''
                      ? undefined
                      : parseInt(e.target.value),
                })
              }
              disabled={loading}
            >
              <option value="">All Modes</option>
              <option value={ChallengeMode.TOB_REGULAR}>Regular Mode</option>
              <option value={ChallengeMode.TOB_HARD}>Hard Mode</option>
            </select>
          </div>

          <div className={styles.filterGroup}>
            <label htmlFor="order-filter">Spawn Order</label>
            <select
              id="order-filter"
              className={styles.filterSelect}
              value={filters.intraChunkOrder ?? ''}
              onChange={(e) =>
                setFilters({
                  ...filters,
                  intraChunkOrder: e.target.value || undefined,
                })
              }
              disabled={loading}
            >
              <option value="">All Spawns</option>
              <option value="0">First in Chunk</option>
              <option value="1">Second in Chunk</option>
              <option value="2">Third in Chunk</option>
              <option value="3">Fourth in Chunk</option>
              <option value="4">Fifth in Chunk</option>
              <option value="5">Sixth in Chunk</option>
            </select>
          </div>
        </div>
      </div>

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Date Range</h3>
        <div className={styles.dateFilters}>
          <div className={styles.filterGroup}>
            <label htmlFor="start-date">From</label>
            <DatePicker
              id="start-date"
              selected={filters.startDate}
              onChange={(date) => setFilters({ ...filters, startDate: date })}
              disabled={loading}
              showIcon
              icon="fas fa-calendar-alt"
              width={150}
              isClearable
              maxDate={filters.endDate ?? today}
            />
          </div>
          <div className={styles.filterGroup}>
            <label htmlFor="end-date">To</label>
            <DatePicker
              id="end-date"
              selected={filters.endDate}
              onChange={(date) => setFilters({ ...filters, endDate: date })}
              disabled={loading}
              showIcon
              icon="fas fa-calendar-alt"
              width={150}
              isClearable
              minDate={filters.startDate ?? undefined}
              maxDate={today}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
