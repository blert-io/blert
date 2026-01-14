import { ChallengeMode, ChallengeType, SessionStatus } from '@blert/common';
import { Dispatch, SetStateAction } from 'react';

import Checkbox from '@/components/checkbox';
import DatePicker from '@/components/date-picker';
import PlayerSearch from '@/components/player-search';
import TagList from '@/components/tag-list';

import { SessionSearchContext, SessionSearchFilters } from './context';

import styles from './style.module.scss';

const DATE_INPUT_WIDTH = 150;

type FiltersProps = {
  context: SessionSearchContext;
  setContext: Dispatch<SetStateAction<SessionSearchContext>>;
  loading: boolean;
};

type ArrayFields<T> = Pick<
  T,
  { [K in keyof T]: T[K] extends any[] ? K : never }[keyof T]
>;

function isTobMode(mode: ChallengeMode) {
  return mode >= ChallengeMode.TOB_ENTRY && mode <= ChallengeMode.TOB_HARD;
}

function toggleTobMode(
  filters: SessionSearchFilters,
  mode: ChallengeMode,
): SessionSearchFilters {
  const remove = filters.mode.includes(mode);
  if (remove) {
    const tobModes = filters.mode.filter(isTobMode).length;
    return {
      ...filters,
      mode: filters.mode.filter((v) => v !== mode),
      type:
        tobModes === 1
          ? filters.type.filter((v) => v !== ChallengeType.TOB)
          : filters.type,
    };
  }

  return {
    ...filters,
    mode: [...filters.mode, mode],
    type: filters.type.includes(ChallengeType.TOB)
      ? filters.type
      : [...filters.type, ChallengeType.TOB],
  };
}

const NO_MODE_CHALLENGE_TYPES = new Set([
  ChallengeType.COLOSSEUM,
  ChallengeType.INFERNO,
  ChallengeType.MOKHAIOTL,
]);

export default function Filters({
  context,
  setContext,
  loading,
}: FiltersProps) {
  function toggle<
    K extends keyof ArrayFields<SessionSearchFilters>,
    V = SessionSearchFilters[K][number],
  >(key: K, value: V) {
    setContext((prev) => ({
      ...prev,
      filters: {
        ...prev.filters,
        [key]: (prev.filters[key] as V[]).includes(value)
          ? prev.filters[key].filter((v) => v !== value)
          : [...prev.filters[key], value],
      },
      pagination: {},
    }));
  }

  function checkbox<
    K extends keyof ArrayFields<SessionSearchFilters>,
    V = SessionSearchFilters[K][number],
  >(key: K, value: V, label: string, disabled: boolean = false) {
    const checked = (context.filters[key] as V[]).includes(value);
    const isDisabled = disabled && !checked;

    return (
      <Checkbox
        checked={checked}
        className={styles.checkbox}
        disabled={loading || isDisabled}
        onChange={() => toggle(key, value)}
        label={label}
        simple
      />
    );
  }

  function toggleNoMode(challengeType: ChallengeType) {
    return setContext((prev) => {
      const remove = prev.filters.type.includes(challengeType);
      if (remove) {
        const keepNoMode = prev.filters.type.some(
          (t) => t !== challengeType && NO_MODE_CHALLENGE_TYPES.has(t),
        );
        return {
          ...prev,
          filters: {
            ...prev.filters,
            type: prev.filters.type.filter((t) => t !== challengeType),
            mode: keepNoMode
              ? prev.filters.mode
              : prev.filters.mode.filter((m) => m !== ChallengeMode.NO_MODE),
          },
          pagination: {},
        };
      }

      const hasNoMode = prev.filters.mode.includes(ChallengeMode.NO_MODE);
      return {
        ...prev,
        filters: {
          ...prev.filters,
          type: [...prev.filters.type, challengeType],
          mode: hasNoMode
            ? prev.filters.mode
            : [...prev.filters.mode, ChallengeMode.NO_MODE],
        },
        pagination: {},
      };
    });
  }

  function noModeChallengeCheckbox(
    challengeType: ChallengeType,
    label: string,
  ) {
    return (
      <Checkbox
        checked={context.filters.type.includes(challengeType)}
        className={styles.checkbox}
        disabled={loading}
        onChange={() => toggleNoMode(challengeType)}
        label={label}
        simple
      />
    );
  }
  const hasTeamChallenges =
    context.filters.type.length === 0 ||
    context.filters.type.includes(ChallengeType.TOB);

  return (
    <div className={styles.filtersContainer}>
      <div className={styles.filterSection}>
        <div className={styles.filterRow}>
          {/* Type filter */}
          <div className={styles.filterGroup}>
            <div className={styles.filterLabel}>
              <label>Type</label>
            </div>
            <div className={styles.checkboxList}>
              <Checkbox
                checked={
                  context.filters.type.includes(ChallengeType.TOB) &&
                  context.filters.mode.includes(ChallengeMode.TOB_REGULAR)
                }
                className={styles.checkbox}
                disabled={loading}
                onChange={() =>
                  setContext((prev) => ({
                    ...prev,
                    filters: toggleTobMode(
                      prev.filters,
                      ChallengeMode.TOB_REGULAR,
                    ),
                    pagination: {},
                  }))
                }
                label="ToB Regular"
                simple
              />
              <Checkbox
                checked={
                  context.filters.type.includes(ChallengeType.TOB) &&
                  context.filters.mode.includes(ChallengeMode.TOB_HARD)
                }
                className={styles.checkbox}
                disabled={loading}
                onChange={() =>
                  setContext((prev) => ({
                    ...prev,
                    filters: toggleTobMode(
                      prev.filters,
                      ChallengeMode.TOB_HARD,
                    ),
                    pagination: {},
                  }))
                }
                label="ToB Hard"
                simple
              />
              {noModeChallengeCheckbox(ChallengeType.INFERNO, 'Inferno')}
              {noModeChallengeCheckbox(ChallengeType.COLOSSEUM, 'Colosseum')}
              {noModeChallengeCheckbox(ChallengeType.MOKHAIOTL, 'Mokhaiotl')}
            </div>
          </div>

          {/* Status filter */}
          <div className={styles.filterGroup}>
            <div className={styles.filterLabel}>
              <label>Status</label>
            </div>
            <div className={styles.checkboxList}>
              {checkbox('status', SessionStatus.COMPLETED, 'Completed')}
              {checkbox('status', SessionStatus.ACTIVE, 'Active')}
            </div>
          </div>

          {/* Scale filter */}
          <div className={styles.filterGroup}>
            <div className={styles.filterLabel}>
              <label>Scale</label>
            </div>
            <div className={styles.checkboxList}>
              {checkbox('scale', 1, 'Solo')}
              {checkbox('scale', 2, 'Duo', !hasTeamChallenges)}
              {checkbox('scale', 3, 'Trio', !hasTeamChallenges)}
              {checkbox('scale', 4, '4s', !hasTeamChallenges)}
              {checkbox('scale', 5, '5s', !hasTeamChallenges)}
            </div>
          </div>

          {/* Party filter */}
          <div className={styles.filterGroup}>
            <div className={styles.filterLabel}>
              <label>Party</label>
            </div>
            <div className={styles.playerSearchContainer}>
              <PlayerSearch
                disabled={loading || context.filters.party.length >= 5}
                label="Enter username"
                labelBg="var(--blert-surface-dark)"
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
                      pagination: {},
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
                    pagination: {},
                  }))
                }
                tags={context.filters.party}
                width={260}
              />
            </div>
          </div>

          {/* Date filter */}
          <div className={styles.filterGroup}>
            <div className={styles.filterLabel}>
              <label>Date</label>
            </div>
            <div className={styles.dateContainer}>
              <div className={styles.dateField}>
                <span className={styles.dateFieldLabel}>From</span>
                <DatePicker
                  disabled={loading}
                  icon="fas fa-calendar-alt"
                  isClearable
                  maxDate={context.filters.endDate ?? new Date()}
                  placeholderText="Any"
                  popperPlacement="bottom"
                  selected={context.filters.startDate}
                  onChange={(date) =>
                    setContext((prev) => ({
                      ...prev,
                      filters: { ...prev.filters, startDate: date },
                      pagination: {},
                    }))
                  }
                  showIcon
                  width={DATE_INPUT_WIDTH}
                />
              </div>
              <div className={styles.dateField}>
                <span className={styles.dateFieldLabel}>To</span>
                <DatePicker
                  disabled={loading}
                  icon="fas fa-calendar-alt"
                  isClearable
                  maxDate={new Date()}
                  minDate={context.filters.startDate ?? undefined}
                  placeholderText="Any"
                  popperPlacement="bottom"
                  selected={context.filters.endDate}
                  onChange={(date) =>
                    setContext((prev) => ({
                      ...prev,
                      filters: { ...prev.filters, endDate: date },
                      pagination: {},
                    }))
                  }
                  showIcon
                  width={DATE_INPUT_WIDTH}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
