import { ChallengeMode } from '@blert/common';
import { Dispatch, SetStateAction } from 'react';

import ComparableInput, { Comparator } from '@/components/comparable-input';
import DatePicker from '@/components/date-picker';

import styles from './controls.module.scss';

export type BloatDownsFilters = {
  mode: ChallengeMode;
  scale: number | null;
  downComparator: Comparator;
  downNumber: number | null;
  startDate: Date | null;
  endDate: Date | null;
};

export const DEFAULT_FILTERS: BloatDownsFilters = {
  mode: ChallengeMode.TOB_REGULAR,
  scale: null,
  downComparator: Comparator.EQUAL,
  downNumber: 1,
  startDate: null,
  endDate: null,
};

type BloatDownsControlsProps = {
  idPrefix: string;
  filters: BloatDownsFilters;
  setFilters: Dispatch<SetStateAction<BloatDownsFilters>>;
};

export default function BloatDownsControls({
  idPrefix,
  filters,
  setFilters,
}: BloatDownsControlsProps) {
  const today = new Date();

  return (
    <div className={styles.controls}>
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Filters</h3>
        <div className={styles.filterGrid}>
          <div className={styles.filterGroup}>
            <label htmlFor={`${idPrefix}-mode`}>Raid Mode</label>
            <select
              id={`${idPrefix}-mode`}
              className={styles.filterSelect}
              value={filters.mode}
              onChange={(e) =>
                setFilters({ ...filters, mode: parseInt(e.target.value) })
              }
            >
              <option value={ChallengeMode.TOB_REGULAR}>Regular Mode</option>
              <option value={ChallengeMode.TOB_HARD}>Hard Mode</option>
            </select>
          </div>

          <div className={styles.filterGroup}>
            <label htmlFor={`${idPrefix}-scale`}>Scale</label>
            <select
              id={`${idPrefix}-scale`}
              className={styles.filterSelect}
              value={filters.scale ?? ''}
              onChange={(e) =>
                setFilters({
                  ...filters,
                  scale:
                    e.target.value === '' ? null : parseInt(e.target.value),
                })
              }
            >
              <option value="">All scales</option>
              <option value="1">Solo</option>
              <option value="2">Duo</option>
              <option value="3">Trio</option>
              <option value="4">4s</option>
              <option value="5">5s</option>
            </select>
          </div>

          <div className={styles.downInput}>
            <ComparableInput
              id={`${idPrefix}-down`}
              label="Down #"
              labelBg="var(--blert-panel-background-color)"
              type="number"
              comparator={filters.downComparator}
              onComparatorChange={(c) =>
                setFilters({ ...filters, downComparator: c })
              }
              value={filters.downNumber?.toString() ?? ''}
              onChange={(e) => {
                const v = parseInt(e.target.value);
                setFilters({
                  ...filters,
                  downNumber: isNaN(v) ? null : v,
                });
              }}
            />
          </div>
        </div>
      </div>

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Date Range</h3>
        <div className={styles.dateFilters}>
          <div className={styles.filterGroup}>
            <label htmlFor={`${idPrefix}-start-date`}>From</label>
            <DatePicker
              id={`${idPrefix}-start-date`}
              selected={filters.startDate}
              onChange={(date) => setFilters({ ...filters, startDate: date })}
              showIcon
              icon="fas fa-calendar-alt"
              width={150}
              isClearable
              maxDate={filters.endDate ?? today}
            />
          </div>
          <div className={styles.filterGroup}>
            <label htmlFor={`${idPrefix}-end-date`}>To</label>
            <DatePicker
              id={`${idPrefix}-end-date`}
              selected={filters.endDate}
              onChange={(date) => setFilters({ ...filters, endDate: date })}
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
