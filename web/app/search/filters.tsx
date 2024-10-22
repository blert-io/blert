import { ChallengeMode, ChallengeStatus, ChallengeType } from '@blert/common';
import { Dispatch, SetStateAction, useState } from 'react';
import DatePicker from 'react-datepicker';

import Checkbox from '@/components/checkbox';
import PlayerSearch from '@/components/player-search';
import TagList from '@/components/tag-list';
import Tooltip from '@/components/tooltip';
import { SearchContext, SearchFilters } from './context';

import 'react-datepicker/dist/react-datepicker.css';
import './date-picker.css';
import styles from './style.module.scss';

const DATE_WIDTH = 300;
const DATE_INPUT_WIDTH = 140;

type FiltersProps = {
  context: SearchContext;
  setContext: Dispatch<SetStateAction<SearchContext>>;
  loading: boolean;
};

type ArrayFields<T> = Pick<
  T,
  { [K in keyof T]: T[K] extends Array<any> ? K : never }[keyof T]
>;

function isTobMode(mode: ChallengeMode) {
  return mode >= ChallengeMode.TOB_ENTRY && mode <= ChallengeMode.TOB_HARD;
}

function toggleTobMode(
  filters: SearchFilters,
  mode: ChallengeMode,
): SearchFilters {
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

export default function Filters({
  context,
  setContext,
  loading,
}: FiltersProps) {
  const [useDateRange, setUseDateRange] = useState(false);

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
          <div className={styles.label}>
            <label>Type</label>
            <button
              className={styles.action}
              disabled={loading}
              onClick={() =>
                setContext((prev) => {
                  if (
                    prev.filters.type.length === 0 &&
                    prev.filters.mode.length === 0
                  ) {
                    return prev;
                  }
                  return {
                    ...prev,
                    filters: { ...prev.filters, type: [], mode: [] },
                  };
                })
              }
            >
              Clear
            </button>
          </div>
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
                filters: toggleTobMode(prev.filters, ChallengeMode.TOB_REGULAR),
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
                filters: toggleTobMode(prev.filters, ChallengeMode.TOB_HARD),
              }))
            }
            label="ToB Hard"
            simple
          />
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
        <div className={`${styles.checkGroup} ${styles.item}`}>
          <div className={styles.label}>
            <label>Extra options</label>
          </div>
          <Tooltip tooltipId="accurate-splits-tooltip">
            <span>
              When sorting by split times, exclude those which are inaccurate.
            </span>
          </Tooltip>
          <div className={styles.checkbox}>
            <div data-tooltip-id="accurate-splits-tooltip">
              <Checkbox
                checked={context.filters.accurateSplits}
                disabled={loading}
                onChange={() =>
                  setContext((prev) => ({
                    ...prev,
                    filters: {
                      ...prev.filters,
                      accurateSplits: !prev.filters.accurateSplits,
                    },
                  }))
                }
                label="Accurate splits"
                simple
              />
            </div>
          </div>
        </div>
      </div>
      <div className={styles.filterGroup}>
        <div className={styles.item}>
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
        <div className={styles.item}>
          <div className={styles.label}>
            <label>Date</label>
          </div>
          <div className={styles.dateWrapper}>
            <div className={styles.date} style={{ width: DATE_WIDTH }}>
              <DatePicker
                customInput={
                  <input
                    className={styles.dateInput}
                    style={{
                      width: useDateRange ? DATE_INPUT_WIDTH : DATE_WIDTH,
                    }}
                  />
                }
                disabled={loading}
                icon="fas fa-calendar-alt"
                isClearable
                maxDate={
                  useDateRange
                    ? context.filters.endDate ?? undefined
                    : undefined
                }
                placeholderText={useDateRange ? 'Start date' : undefined}
                popperClassName="blert-datepicker"
                popperPlacement="bottom"
                selected={context.filters.startDate}
                onChange={(date) => {
                  const endDate = useDateRange ? context.filters.endDate : date;
                  setContext((prev) => ({
                    ...prev,
                    filters: {
                      ...prev.filters,
                      startDate: date,
                      endDate,
                    },
                  }));
                }}
                showIcon
                wrapperClassName="blert-datepicker-wrapper"
              />
              {useDateRange && (
                <>
                  <i className="fas fa-minus" />
                  <DatePicker
                    customInput={
                      <input
                        className={styles.dateInput}
                        style={{ width: DATE_INPUT_WIDTH }}
                      />
                    }
                    disabled={loading}
                    icon="fas fa-calendar-alt"
                    isClearable
                    minDate={
                      useDateRange
                        ? context.filters.startDate ?? undefined
                        : undefined
                    }
                    placeholderText="End date"
                    popperClassName="blert-datepicker"
                    popperPlacement="bottom"
                    selected={context.filters.endDate}
                    onChange={(date) =>
                      setContext((prev) => ({
                        ...prev,
                        filters: { ...prev.filters, endDate: date },
                      }))
                    }
                    showIcon
                    wrapperClassName="blert-datepicker-wrapper"
                  />
                </>
              )}
            </div>
            <Checkbox
              checked={useDateRange}
              className={styles.dateRangeCheckbox}
              disabled={loading}
              onChange={() => {
                if (useDateRange) {
                  if (context.filters.startDate !== null) {
                    setContext((prev) => ({
                      ...prev,
                      filters: {
                        ...prev.filters,
                        endDate: prev.filters.startDate,
                      },
                    }));
                  } else if (context.filters.endDate !== null) {
                    setContext((prev) => ({
                      ...prev,
                      filters: {
                        ...prev.filters,
                        startDate: prev.filters.endDate,
                      },
                    }));
                  }
                }
                setUseDateRange((prev) => !prev);
              }}
              label="Date range"
              simple
            />
          </div>
        </div>
      </div>
    </div>
  );
}
