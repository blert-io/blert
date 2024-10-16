import { ChallengeStatus, ChallengeType } from '@blert/common';
import { Dispatch, SetStateAction } from 'react';

import Checkbox from '@/components/checkbox';
import { SearchContext, SearchFilters } from './context';

import styles from './style.module.scss';

type FiltersProps = {
  context: SearchContext;
  setContext: Dispatch<SetStateAction<SearchContext>>;
  loading: boolean;
};

type ArrayFields<T> = Pick<
  T,
  { [K in keyof T]: T[K] extends Array<any> ? K : never }[keyof T]
>;

export default function Filters({
  context,
  setContext,
  loading,
}: FiltersProps) {
  function toggle<
    K extends keyof ArrayFields<SearchFilters>,
    V = SearchFilters[K][number],
  >(key: K, value: V) {
    setContext((prev) => ({
      ...prev,
      filters: {
        ...prev.filters,
        [key]: (prev.filters[key] as V[]).includes(value)
          ? prev.filters[key].filter((v) => v !== value)
          : [...prev.filters[key], value],
      },
    }));
  }

  function checkbox<
    K extends keyof ArrayFields<SearchFilters>,
    V = SearchFilters[K][number],
  >(key: K, value: V, label: string) {
    return (
      <Checkbox
        checked={(context.filters[key] as V[]).includes(value)}
        className={styles.checkbox}
        disabled={loading}
        onChange={() => toggle(key, value)}
        label={label}
        simple
      />
    );
  }

  return (
    <div className={styles.filters}>
      <div className={styles.filterGroup}>
        <div className={styles.checkGroup}>
          <div className={styles.label}>
            <label>Type</label>
            <button
              className={styles.action}
              disabled={loading}
              onClick={() =>
                setContext((prev) => ({
                  ...prev,
                  filters: { ...prev.filters, type: [] },
                }))
              }
            >
              Clear
            </button>
          </div>
          {checkbox('type', ChallengeType.TOB, 'ToB')}
          {checkbox('type', ChallengeType.COLOSSEUM, 'Colosseum')}
        </div>
        <div className={styles.checkGroup}>
          <div className={styles.label}>
            <label>Status</label>
            <button
              className={styles.action}
              disabled={loading}
              onClick={() =>
                setContext((prev) => ({
                  ...prev,
                  filters: { ...prev.filters, status: [] },
                }))
              }
            >
              Clear
            </button>
          </div>
          {checkbox('status', ChallengeStatus.IN_PROGRESS, 'In Progress')}
          {checkbox('status', ChallengeStatus.COMPLETED, 'Completion')}
          {checkbox('status', ChallengeStatus.WIPED, 'Wipe')}
          {checkbox('status', ChallengeStatus.RESET, 'Reset')}
        </div>
        <div className={styles.checkGroup}>
          <div className={styles.label}>
            <label>Scale</label>
            <button
              className={styles.action}
              disabled={loading}
              onClick={() =>
                setContext((prev) => ({
                  ...prev,
                  filters: { ...prev.filters, scale: [] },
                }))
              }
            >
              Clear
            </button>
          </div>
          {checkbox('scale', 1, 'Solo')}
          {checkbox('scale', 2, 'Duo')}
          {checkbox('scale', 3, 'Trio')}
          {checkbox('scale', 4, '4s')}
          {checkbox('scale', 5, '5s')}
        </div>
      </div>
    </div>
  );
}
