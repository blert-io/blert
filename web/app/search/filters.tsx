import { ChallengeStatus, ChallengeType } from '@blert/common';
import { Dispatch, SetStateAction } from 'react';

import Checkbox from '@/components/checkbox';
import PlayerSearch from '@/components/player-search';
import TagList from '@/components/tag-list';
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

  function clearLabel(label: string, key: keyof ArrayFields<SearchFilters>) {
    return (
      <div className={styles.label}>
        <label>{label}</label>
        <button
          className={styles.action}
          disabled={loading}
          onClick={() =>
            setContext((prev) => {
              if (prev.filters[key].length === 0) {
                return prev;
              }
              return {
                ...prev,
                filters: { ...prev.filters, [key]: [] },
              };
            })
          }
        >
          Clear
        </button>
      </div>
    );
  }

  return (
    <div className={styles.filters}>
      <div className={styles.filterGroup}>
        <div className={`${styles.checkGroup} ${styles.item}`}>
          {clearLabel('Type', 'type')}
          {checkbox('type', ChallengeType.TOB, 'ToB')}
          {checkbox('type', ChallengeType.COLOSSEUM, 'Colosseum')}
        </div>
        <div className={`${styles.checkGroup} ${styles.item}`}>
          {clearLabel('Status', 'status')}
          {checkbox('status', ChallengeStatus.IN_PROGRESS, 'In Progress')}
          {checkbox('status', ChallengeStatus.COMPLETED, 'Completion')}
          {checkbox('status', ChallengeStatus.WIPED, 'Wipe')}
          {checkbox('status', ChallengeStatus.RESET, 'Reset')}
        </div>
        <div className={`${styles.checkGroup} ${styles.item}`}>
          {clearLabel('Scale', 'scale')}
          {checkbox('scale', 1, 'Solo')}
          {checkbox('scale', 2, 'Duo')}
          {checkbox('scale', 3, 'Trio')}
          {checkbox('scale', 4, '4s')}
          {checkbox('scale', 5, '5s')}
        </div>
      </div>
      <div className={styles.filterGroup}>
        <div className={`${styles.item}`}>
          {clearLabel('Party', 'party')}
          <PlayerSearch
            disabled={loading || context.filters.party.length >= 5}
            label="Enter username"
            id="filters-player"
            onSelection={(username) =>
              setContext((prev) => {
                if (prev.filters.party.includes(username)) {
                  return prev;
                }
                return {
                  ...prev,
                  filters: {
                    ...prev.filters,
                    party: [...prev.filters.party, username],
                  },
                };
              })
            }
          />
          <TagList
            onRemove={(username) =>
              setContext((prev) => ({
                ...prev,
                filters: {
                  ...prev.filters,
                  party: prev.filters.party.filter((u) => u !== username),
                },
              }))
            }
            tags={context.filters.party}
            width={300}
          />
        </div>
      </div>
    </div>
  );
}
