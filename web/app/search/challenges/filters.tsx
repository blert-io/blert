import {
  ChallengeMode,
  ChallengeStatus,
  ChallengeType,
  SplitType,
  Stage,
} from '@blert/common';
import React, { Dispatch, SetStateAction, useContext, useState } from 'react';

import Button from '@/components/button';
import Checkbox from '@/components/checkbox';
import ComparableInput, { Comparator } from '@/components/comparable-input';
import DatePicker from '@/components/date-picker';
import Menu, { MenuItem } from '@/components/menu';
import Modal from '@/components/modal';
import PlayerSearch from '@/components/player-search';
import TagList from '@/components/tag-list';
import TickInput from '@/components/tick-input';
import Tooltip from '@/components/tooltip';
import { DisplayContext } from '@/display';

import {
  SearchContext,
  SearchFilters,
  emptyTobFilters,
  hasTobFilters,
} from './context';

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
  { [K in keyof T]: T[K] extends any[] ? K : never }[keyof T]
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

const STAGE_MENU_ITEMS: MenuItem[] = [
  {
    label: 'ToB',
    subMenu: [
      { label: 'Maiden', value: Stage.TOB_MAIDEN },
      { label: 'Bloat', value: Stage.TOB_BLOAT },
      { label: 'Nylocas', value: Stage.TOB_NYLOCAS },
      { label: 'Sotetseg', value: Stage.TOB_SOTETSEG },
      { label: 'Xarpus', value: Stage.TOB_XARPUS },
      { label: 'Verzik', value: Stage.TOB_VERZIK },
    ],
  },
  {
    label: 'Inferno',
    subMenu: [
      { label: 'Wave 9', value: Stage.INFERNO_WAVE_9 },
      { label: 'Wave 18', value: Stage.INFERNO_WAVE_18 },
      { label: 'Wave 25', value: Stage.INFERNO_WAVE_25 },
      { label: 'Wave 35', value: Stage.INFERNO_WAVE_35 },
      { label: 'Wave 42', value: Stage.INFERNO_WAVE_42 },
      { label: 'Wave 50', value: Stage.INFERNO_WAVE_50 },
      { label: 'Wave 57', value: Stage.INFERNO_WAVE_57 },
      { label: 'Wave 60', value: Stage.INFERNO_WAVE_60 },
      { label: 'Wave 63', value: Stage.INFERNO_WAVE_63 },
      { label: 'Wave 66', value: Stage.INFERNO_WAVE_66 },
      { label: 'Wave 67', value: Stage.INFERNO_WAVE_67 },
      { label: 'Wave 68', value: Stage.INFERNO_WAVE_68 },
      { label: 'Wave 69', value: Stage.INFERNO_WAVE_69 },
    ],
  },
  {
    label: 'Colosseum',
    subMenu: [
      { label: 'Wave 1', value: Stage.COLOSSEUM_WAVE_1 },
      { label: 'Wave 2', value: Stage.COLOSSEUM_WAVE_2 },
      { label: 'Wave 3', value: Stage.COLOSSEUM_WAVE_3 },
      { label: 'Wave 4', value: Stage.COLOSSEUM_WAVE_4 },
      { label: 'Wave 5', value: Stage.COLOSSEUM_WAVE_5 },
      { label: 'Wave 6', value: Stage.COLOSSEUM_WAVE_6 },
      { label: 'Wave 7', value: Stage.COLOSSEUM_WAVE_7 },
      { label: 'Wave 8', value: Stage.COLOSSEUM_WAVE_8 },
      { label: 'Wave 9', value: Stage.COLOSSEUM_WAVE_9 },
      { label: 'Wave 10', value: Stage.COLOSSEUM_WAVE_10 },
      { label: 'Sol Heredit', value: Stage.COLOSSEUM_WAVE_11 },
    ],
  },
  {
    label: 'Mokhaiotl',
    subMenu: [
      { label: 'Delve 1', value: Stage.MOKHAIOTL_DELVE_1 },
      { label: 'Delve 2', value: Stage.MOKHAIOTL_DELVE_2 },
      { label: 'Delve 3', value: Stage.MOKHAIOTL_DELVE_3 },
      { label: 'Delve 4', value: Stage.MOKHAIOTL_DELVE_4 },
      { label: 'Delve 5', value: Stage.MOKHAIOTL_DELVE_5 },
      { label: 'Delve 6', value: Stage.MOKHAIOTL_DELVE_6 },
      { label: 'Delve 7', value: Stage.MOKHAIOTL_DELVE_7 },
      { label: 'Delve 8', value: Stage.MOKHAIOTL_DELVE_8 },
    ],
  },
];

const STAGE_OPERATORS = [
  { label: 'is', value: Comparator.EQUAL },
  { label: 'is at least', value: Comparator.GREATER_THAN_OR_EQUAL },
  { label: 'is at most', value: Comparator.LESS_THAN_OR_EQUAL },
];

export default function Filters({
  context,
  setContext,
  loading,
}: FiltersProps) {
  const [useDateRange, setUseDateRange] = useState(() => {
    if (
      context.filters.startDate !== null &&
      context.filters.endDate !== null
    ) {
      return (
        context.filters.startDate.getTime() !==
        context.filters.endDate.getTime()
      );
    }

    return (
      context.filters.startDate !== null || context.filters.endDate !== null
    );
  });

  const [stageMenuOpen, setStageMenuOpen] = useState(false);
  const [stageOperatorMenuOpen, setStageOperatorMenuOpen] = useState(false);

  const [stageOperator, setStageOperator] = useState(
    context.filters.stage?.[0] ?? Comparator.EQUAL,
  );
  const selectedStage = context.filters.stage?.[1] ?? null;

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
      pagination: {},
    }));
  }

  function checkbox<
    K extends keyof ArrayFields<SearchFilters>,
    V = SearchFilters[K][number],
  >(key: K, value: V, label: string, disabled: boolean = false) {
    const checked = (context.filters[key] as V[]).includes(value);
    const isDisabled = disabled && !checked; // Allow unchecking if disabled.

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
                pagination: {},
              };
            })
          }
        >
          Clear
        </button>
      </div>
    );
  }

  const hasTeamChallenges =
    context.filters.type.length === 0 ||
    context.filters.type.includes(ChallengeType.TOB);

  const tobFiltersActive = hasTobFilters(context.filters.tob);

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
                    pagination: {},
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
                filters: toggleTobMode(prev.filters, ChallengeMode.TOB_HARD),
                pagination: {},
              }))
            }
            label="ToB Hard"
            simple
          />
          {checkbox('type', ChallengeType.INFERNO, 'Inferno', tobFiltersActive)}
          {checkbox(
            'type',
            ChallengeType.COLOSSEUM,
            'Colosseum',
            tobFiltersActive,
          )}
          {checkbox(
            'type',
            ChallengeType.MOKHAIOTL,
            'Mokhaiotl',
            tobFiltersActive,
          )}
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
          {checkbox('scale', 2, 'Duo', !hasTeamChallenges)}
          {checkbox('scale', 3, 'Trio', !hasTeamChallenges)}
          {checkbox('scale', 4, '4s', !hasTeamChallenges)}
          {checkbox('scale', 5, '5s', !hasTeamChallenges)}
        </div>
        <div className={`${styles.checkGroup} ${styles.item}`}>
          <div className={styles.label}>
            <label>Stage</label>
            <button
              className={styles.action}
              disabled={loading}
              onClick={() => {
                setStageOperator(Comparator.EQUAL);
                setContext((prev) => ({
                  ...prev,
                  filters: { ...prev.filters, stage: null },
                  pagination: {},
                }));
              }}
            >
              Clear
            </button>
          </div>
          <div className={styles.stageFilter}>
            <button
              id="stage-operator-select"
              className={styles.action}
              onClick={() => setStageOperatorMenuOpen(true)}
            >
              {STAGE_OPERATORS.find((op) => op.value === stageOperator)
                ?.label ?? 'Select operator'}
              <i className="fas fa-chevron-down" style={{ marginLeft: 8 }} />
            </button>
            <button
              id="stage-select"
              className={styles.action}
              onClick={() => setStageMenuOpen(true)}
            >
              {selectedStage
                ? STAGE_MENU_ITEMS.flatMap((m) => m.subMenu!).find(
                    (item) => item.value === selectedStage,
                  )?.label
                : 'Select stage'}
              <i className="fas fa-chevron-down" style={{ marginLeft: 8 }} />
            </button>
            <Menu
              onClose={() => setStageOperatorMenuOpen(false)}
              onSelection={(value) => {
                const operator = value as Comparator;
                setStageOperator(operator);
                setStageOperatorMenuOpen(false);
                if (selectedStage !== null) {
                  setContext((prev) => ({
                    ...prev,
                    filters: {
                      ...prev.filters,
                      stage: [operator, selectedStage],
                    },
                    pagination: {},
                  }));
                } else {
                  setContext((prev) => ({
                    ...prev,
                    filters: {
                      ...prev.filters,
                      stage: null,
                    },
                    pagination: {},
                  }));
                }
              }}
              open={stageOperatorMenuOpen}
              items={STAGE_OPERATORS}
              targetId="stage-operator-select"
              width={DATE_INPUT_WIDTH}
            />
            <Menu
              onClose={() => setStageMenuOpen(false)}
              onSelection={(value) => {
                const stage = parseInt(value as string, 10);
                setStageMenuOpen(false);
                setContext((prev) => ({
                  ...prev,
                  filters: {
                    ...prev.filters,
                    stage: [stageOperator, stage],
                  },
                  pagination: {},
                }));
              }}
              open={stageMenuOpen}
              items={STAGE_MENU_ITEMS}
              targetId="stage-select"
              width={DATE_INPUT_WIDTH}
            />
          </div>
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
                    pagination: {},
                  }))
                }
                label="Accurate splits"
                simple
              />
            </div>
          </div>
          <Tooltip tooltipId="full-recordings-tooltip">
            <span>Exclude challenges that are missing data for any stage.</span>
          </Tooltip>
          <div className={styles.checkbox}>
            <div data-tooltip-id="full-recordings-tooltip">
              <Checkbox
                checked={context.filters.fullRecordings}
                disabled={loading}
                onChange={() =>
                  setContext((prev) => ({
                    ...prev,
                    filters: {
                      ...prev.filters,
                      fullRecordings: !prev.filters.fullRecordings,
                    },
                    pagination: {},
                  }))
                }
                label="Full recordings"
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
                disabled={loading}
                icon="fas fa-calendar-alt"
                isClearable
                maxDate={
                  useDateRange
                    ? (context.filters.endDate ?? undefined)
                    : undefined
                }
                placeholderText={useDateRange ? 'Start date' : undefined}
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
                    pagination: {},
                  }));
                }}
                showIcon
                width={useDateRange ? DATE_INPUT_WIDTH : DATE_WIDTH}
              />
              {useDateRange && (
                <>
                  <i className="fas fa-minus" />
                  <DatePicker
                    disabled={loading}
                    icon="fas fa-calendar-alt"
                    isClearable
                    minDate={
                      useDateRange
                        ? (context.filters.startDate ?? undefined)
                        : undefined
                    }
                    placeholderText="End date"
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
                      pagination: {},
                    }));
                  } else if (context.filters.endDate !== null) {
                    setContext((prev) => ({
                      ...prev,
                      filters: {
                        ...prev.filters,
                        startDate: prev.filters.endDate,
                      },
                      pagination: {},
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
      <div className={styles.divider} />
      <CustomFilters
        context={context}
        loading={loading}
        setContext={setContext}
      />
    </div>
  );
}

type FilterValue = [Comparator, number];

type IsFilterCollection<T> =
  T extends Map<number, FilterValue>
    ? true
    : string extends keyof T
      ? T extends Record<string, FilterValue>
        ? true
        : false
      : false;

type ScalarFilterPaths<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends FilterValue | null
    ? `${Prefix}${K}`
    : IsFilterCollection<T[K]> extends true
      ? never
      : T[K] extends unknown[] | Map<unknown, unknown>
        ? never
        : T[K] extends object
          ? ScalarFilterPaths<T[K], `${Prefix}${K}.`>
          : never;
}[keyof T & string];

type KeyedFilterPaths<T, Prefix extends string = ''> = {
  [K in keyof T & string]: IsFilterCollection<T[K]> extends true
    ? `${Prefix}${K}`
    : T[K] extends unknown[] | Map<unknown, unknown>
      ? never
      : T[K] extends object
        ? KeyedFilterPaths<T[K], `${Prefix}${K}.`>
        : never;
}[keyof T & string];

type PathValue<T, P extends string> = P extends `${infer K}.${infer Rest}`
  ? K extends keyof T
    ? PathValue<T[K], Rest>
    : never
  : P extends keyof T
    ? T[P]
    : never;

type InputKind = 'time' | 'ticks' | 'number';

type ScalarTarget = {
  [P in ScalarFilterPaths<SearchFilters>]: {
    path: P;
    inputKind: InputKind;
  };
}[ScalarFilterPaths<SearchFilters>];

type KeyedTarget = {
  [P in KeyedFilterPaths<SearchFilters>]: {
    path: P;
    key: PathValue<SearchFilters, P> extends Map<infer K, FilterValue>
      ? K
      : PathValue<SearchFilters, P> extends Record<infer K, FilterValue>
        ? K
        : never;
    inputKind: InputKind;
  };
}[KeyedFilterPaths<SearchFilters>];

type FilterTarget = ScalarTarget | KeyedTarget;

type FilterDef = FilterTarget & { label: string; round?: number };

function filterKey(target: FilterTarget): string {
  if ('key' in target) {
    return `${target.path}:${target.key}`;
  }
  return target.path;
}

function resolve<P extends string>(
  obj: SearchFilters,
  path: P,
): PathValue<SearchFilters, P> {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    current = (current as Record<string, unknown>)[part];
  }
  return current as PathValue<SearchFilters, P>;
}

function getFilterValue(
  filters: SearchFilters,
  target: FilterTarget,
): FilterValue | null {
  if ('key' in target) {
    const collection = resolve(filters, target.path);
    return collection.get(target.key) ?? null;
  }
  return resolve(filters, target.path);
}

function setFilterValue(
  filters: SearchFilters,
  target: FilterTarget,
  value: FilterValue | null,
): void {
  if ('key' in target) {
    const collection = resolve(filters, target.path);
    if (value === null) {
      collection.delete(target.key);
    } else {
      collection.set(target.key, value);
    }
  } else {
    const parts = target.path.split('.');
    const parentPath = parts.slice(0, -1).join('.');
    const key = parts[parts.length - 1];
    const parent = parentPath
      ? resolve(filters, parentPath as ScalarFilterPaths<SearchFilters>)
      : filters;
    (parent as Record<string, unknown>)[key] = value;
  }
}

// Filter definitions referenced by custom filter items.
const FILTER_DEFS: Record<string, FilterDef> = {};

function def(label: string, target: FilterTarget): FilterDef & { id: string } {
  const id = filterKey(target);
  const d = { ...target, label };
  FILTER_DEFS[id] = d;
  return { ...d, id };
}

function splitDef(label: string, split: SplitType, round?: number) {
  const id = filterKey({ path: 'splits', key: split, inputKind: 'time' });
  const d: FilterDef = {
    path: 'splits',
    key: split,
    inputKind: 'time',
    label,
    round,
  };
  FILTER_DEFS[id] = d;
  return { ...d, id };
}

function bloatDownDef(label: string, downNumber: number) {
  return def(label, {
    path: 'tob.bloatDowns',
    key: downNumber,
    inputKind: 'ticks',
  });
}

const s = splitDef;
const bd = bloatDownDef;

const CUSTOM_FILTERS_ITEMS: MenuItem[] = [
  {
    label: 'ToB',
    subMenu: [
      {
        label: 'Bloat',
        subMenu: [
          {
            label: 'Down count',
            value: def('Bloat down count', {
              path: 'tob.bloatDownCount',
              inputKind: 'number',
            }).id,
          },
          { label: '1st down walk', value: bd('1st down walk', 1).id },
          { label: '2nd down walk', value: bd('2nd down walk', 2).id },
          { label: '3rd down walk', value: bd('3rd down walk', 3).id },
        ],
      },
      {
        label: 'Nylocas',
        subMenu: [
          {
            label: 'Pre-cap stalls',
            value: def('Nylo pre-cap stalls', {
              path: 'tob.nylocasPreCapStalls',
              inputKind: 'number',
            }).id,
          },
          {
            label: 'Post-cap stalls',
            value: def('Nylo post-cap stalls', {
              path: 'tob.nylocasPostCapStalls',
              inputKind: 'number',
            }).id,
          },
        ],
      },
      {
        label: 'Verzik',
        subMenu: [
          {
            label: 'Reds spawns',
            value: def('Verzik reds spawns', {
              path: 'tob.verzikRedsCount',
              inputKind: 'number',
            }).id,
          },
        ],
      },
    ],
  },
  {
    label: 'Splits',
    subMenu: [
      {
        label: 'ToB',
        subMenu: [
          {
            label: 'Challenge time',
            value: s('Challenge time', SplitType.TOB_CHALLENGE).id,
          },
          {
            label: 'Overall time',
            value: s('Overall time', SplitType.TOB_OVERALL).id,
          },
          {
            label: 'Maiden',
            subMenu: [
              {
                label: 'Room time',
                value: s('Maiden room', SplitType.TOB_MAIDEN).id,
              },
              {
                label: '70s spawn',
                value: s('Maiden 70s', SplitType.TOB_MAIDEN_70S).id,
              },
              {
                label: '50s spawn',
                value: s('Maiden 50s', SplitType.TOB_MAIDEN_50S).id,
              },
              {
                label: '30s spawn',
                value: s('Maiden 30s', SplitType.TOB_MAIDEN_30S).id,
              },
              {
                label: '70s-50s push',
                value: s('Maiden 70s-50s', SplitType.TOB_MAIDEN_70S_50S).id,
              },
              {
                label: '50s-30s push',
                value: s('Maiden 50s-30s', SplitType.TOB_MAIDEN_50S_30S).id,
              },
              {
                label: '30s-end',
                value: s('Maiden 30s-end', SplitType.TOB_MAIDEN_30S_END).id,
              },
            ],
          },
          {
            label: 'Bloat time',
            value: s('Bloat time', SplitType.TOB_BLOAT).id,
          },
          {
            label: 'Nylocas',
            subMenu: [
              {
                label: 'Room time',
                value: s('Nylo room', SplitType.TOB_NYLO_ROOM).id,
              },
              {
                label: 'Boss spawn',
                value: s('Nylo boss spawn', SplitType.TOB_NYLO_BOSS_SPAWN, 4)
                  .id,
              },
              {
                label: 'Boss time',
                value: s('Nylo boss', SplitType.TOB_NYLO_BOSS, 4).id,
              },
            ],
          },
          {
            label: 'Sotetseg',
            subMenu: [
              {
                label: 'Room time',
                value: s('Sote room', SplitType.TOB_SOTETSEG).id,
              },
              {
                label: 'Maze 1 proc',
                value: s('Sote 66', SplitType.TOB_SOTETSEG_66).id,
              },
              {
                label: 'Maze 1 time',
                value: s('Sote maze 1', SplitType.TOB_SOTETSEG_MAZE_1).id,
              },
              {
                label: 'Maze 2 proc',
                value: s('Sote 33', SplitType.TOB_SOTETSEG_33).id,
              },
              {
                label: 'Maze 2 time',
                value: s('Sote maze 2', SplitType.TOB_SOTETSEG_MAZE_2).id,
              },
            ],
          },
          {
            label: 'Xarpus',
            subMenu: [
              {
                label: 'Room time',
                value: s('Xarpus room', SplitType.TOB_XARPUS).id,
              },
              {
                label: 'Screech time',
                value: s('Xarpus screech', SplitType.TOB_XARPUS_SCREECH).id,
              },
            ],
          },
          {
            label: 'Verzik',
            subMenu: [
              {
                label: 'Room time',
                value: s('Verzik room', SplitType.TOB_VERZIK_ROOM).id,
              },
              {
                label: 'P1 time',
                value: s('Verzik P1', SplitType.TOB_VERZIK_P1).id,
              },
              {
                label: 'Reds spawn',
                value: s('Verzik reds', SplitType.TOB_VERZIK_REDS).id,
              },
              {
                label: 'P2 end',
                value: s('Verzik P2 end', SplitType.TOB_VERZIK_P2_END).id,
              },
              {
                label: 'P2 time',
                value: s('Verzik P2', SplitType.TOB_VERZIK_P2).id,
              },
              {
                label: 'P3 time',
                value: s('Verzik P3', SplitType.TOB_VERZIK_P3).id,
              },
            ],
          },
        ],
      },
      {
        label: 'Inferno',
        subMenu: [
          {
            label: 'Wave 9 entry',
            value: s('Wave 9 entry', SplitType.INFERNO_WAVE_9_START).id,
          },
          {
            label: 'Wave 18 entry',
            value: s('Wave 18 entry', SplitType.INFERNO_WAVE_18_START).id,
          },
          {
            label: 'Wave 25 entry',
            value: s('Wave 25 entry', SplitType.INFERNO_WAVE_25_START).id,
          },
          {
            label: 'Wave 35 entry',
            value: s('Wave 35 entry', SplitType.INFERNO_WAVE_35_START).id,
          },
          {
            label: 'Wave 42 entry',
            value: s('Wave 42 entry', SplitType.INFERNO_WAVE_42_START).id,
          },
          {
            label: 'Wave 50 entry',
            value: s('Wave 50 entry', SplitType.INFERNO_WAVE_50_START).id,
          },
          {
            label: 'Wave 57 entry',
            value: s('Wave 57 entry', SplitType.INFERNO_WAVE_57_START).id,
          },
          {
            label: 'Wave 60 entry',
            value: s('Wave 60 entry', SplitType.INFERNO_WAVE_60_START).id,
          },
          {
            label: 'Wave 63 entry',
            value: s('Wave 63 entry', SplitType.INFERNO_WAVE_63_START).id,
          },
          {
            label: 'Wave 66 entry',
            value: s('Wave 66 entry', SplitType.INFERNO_WAVE_66_START).id,
          },
          {
            label: 'Wave 68 entry',
            value: s('Wave 68 entry', SplitType.INFERNO_WAVE_68_START).id,
          },
          {
            label: 'Wave 69 entry',
            value: s('Wave 69 entry', SplitType.INFERNO_WAVE_69_START).id,
          },
        ],
      },
      {
        label: 'Colosseum',
        subMenu: [
          {
            label: 'Wave 1',
            value: s('Wave 1', SplitType.COLOSSEUM_WAVE_1).id,
          },
          {
            label: 'Wave 2',
            value: s('Wave 2', SplitType.COLOSSEUM_WAVE_2).id,
          },
          {
            label: 'Wave 3',
            value: s('Wave 3', SplitType.COLOSSEUM_WAVE_3).id,
          },
          {
            label: 'Wave 4',
            value: s('Wave 4', SplitType.COLOSSEUM_WAVE_4).id,
          },
          {
            label: 'Wave 5',
            value: s('Wave 5', SplitType.COLOSSEUM_WAVE_5).id,
          },
          {
            label: 'Wave 6',
            value: s('Wave 6', SplitType.COLOSSEUM_WAVE_6).id,
          },
          {
            label: 'Wave 7',
            value: s('Wave 7', SplitType.COLOSSEUM_WAVE_7).id,
          },
          {
            label: 'Wave 8',
            value: s('Wave 8', SplitType.COLOSSEUM_WAVE_8).id,
          },
          {
            label: 'Wave 9',
            value: s('Wave 9', SplitType.COLOSSEUM_WAVE_9).id,
          },
          {
            label: 'Wave 10',
            value: s('Wave 10', SplitType.COLOSSEUM_WAVE_10).id,
          },
          {
            label: 'Wave 11',
            value: s('Wave 11', SplitType.COLOSSEUM_WAVE_11).id,
          },
          {
            label: 'Sol Heredit',
            value: s('Sol Heredit', SplitType.COLOSSEUM_WAVE_12).id,
          },
        ],
      },
      {
        label: 'Mokhaiotl',
        subMenu: [
          {
            label: 'Delve 1',
            value: s('Delve 1', SplitType.MOKHAIOTL_DELVE_1).id,
          },
          {
            label: 'Delve 2',
            value: s('Delve 2', SplitType.MOKHAIOTL_DELVE_2).id,
          },
          {
            label: 'Delve 3',
            value: s('Delve 3', SplitType.MOKHAIOTL_DELVE_3).id,
          },
          {
            label: 'Delve 4',
            value: s('Delve 4', SplitType.MOKHAIOTL_DELVE_4).id,
          },
          {
            label: 'Delve 5',
            value: s('Delve 5', SplitType.MOKHAIOTL_DELVE_5).id,
          },
          {
            label: 'Delve 6',
            value: s('Delve 6', SplitType.MOKHAIOTL_DELVE_6).id,
          },
          {
            label: 'Delve 7',
            value: s('Delve 7', SplitType.MOKHAIOTL_DELVE_7).id,
          },
          {
            label: 'Delve 8',
            value: s('Delve 8', SplitType.MOKHAIOTL_DELVE_8).id,
          },
        ],
      },
    ],
  },
];

type SplitValues = {
  ticks: number | null;
  comparator: Comparator;
};

function CustomFilters({
  context,
  loading,
  setContext,
}: {
  context: SearchContext;
  loading: boolean;
  setContext: Dispatch<SetStateAction<SearchContext>>;
}) {
  const display = useContext(DisplayContext);

  const [menuOpen, setMenuOpen] = useState(false);
  const [customInputs, setCustomInputs] = useState<Record<string, SplitValues>>(
    () => {
      const inputs: Record<string, SplitValues> = {};
      for (const [id, filterDef] of Object.entries(FILTER_DEFS)) {
        const value = getFilterValue(context.filters, filterDef);
        if (value !== null) {
          inputs[id] = { ticks: value[1], comparator: value[0] };
        }
      }
      return inputs;
    },
  );
  const [modified, setModified] = useState(false);

  const addInput = (id: string | number) => {
    const key = String(id);
    setModified(true);
    setCustomInputs((prev) => {
      if (prev[key] !== undefined) {
        return prev;
      }
      return {
        ...prev,
        [key]: { ticks: null, comparator: Comparator.EQUAL },
      };
    });
  };

  const applyFilters = (e: React.FormEvent) => {
    e.preventDefault();

    if (loading) {
      return;
    }

    setModified(false);
    setContext((prev) => {
      const next = {
        ...prev,
        filters: {
          ...prev.filters,
          splits: new Map<number, [Comparator, number]>(),
          tob: emptyTobFilters(),
        },
        pagination: {},
      };

      for (const [id, { ticks, comparator }] of Object.entries(customInputs)) {
        if (ticks === null) {
          continue;
        }
        const filterDef = FILTER_DEFS[id];
        if (filterDef !== undefined) {
          setFilterValue(next.filters, filterDef, [comparator, ticks]);
        }
      }

      return next;
    });
  };

  return (
    <form
      className={`${styles.filterGroup} ${styles.custom}`}
      onSubmit={applyFilters}
    >
      <div className={styles.customHeading}>
        <label>Custom filters</label>
        <div className={styles.actions}>
          <Button
            id="filters-add-custom"
            className={styles.action}
            onClick={() => {
              setTimeout(() => setMenuOpen(true), 25);
            }}
            simple
          >
            <i className="fas fa-plus-circle" />
            Add filter
          </Button>
          <Button
            className={styles.action}
            disabled={loading || !modified}
            simple
            type="submit"
          >
            Apply
          </Button>
          {display.isFull() ? (
            <Menu
              onClose={() => setMenuOpen(false)}
              onSelection={addInput}
              open={menuOpen}
              items={CUSTOM_FILTERS_ITEMS}
              targetId="filters-add-custom"
              width="auto"
            />
          ) : (
            <CustomFiltersModal
              onClose={() => setMenuOpen(false)}
              onSelection={addInput}
              open={menuOpen}
            />
          )}
        </div>
      </div>
      <div className={styles.inputs}>
        {Object.keys(customInputs).map((id) => {
          const filterDef = FILTER_DEFS[id];
          if (filterDef === undefined) {
            return null;
          }

          const input = customInputs[id];
          const removeFilter = () => {
            setModified(true);
            setCustomInputs((prev) => {
              const next = { ...prev };
              delete next[id];
              return next;
            });
          };
          const onChange = (value: number | null, cmp?: Comparator) => {
            setModified(true);
            setCustomInputs((prev) => ({
              ...prev,
              [id]: { ticks: value, comparator: cmp ?? Comparator.EQUAL },
            }));
          };

          return (
            <div key={id} className={styles.customInput}>
              {filterDef.inputKind === 'number' ? (
                <ComparableInput
                  id={`filters-custom-${id}`}
                  label={filterDef.label}
                  labelBg="var(--blert-surface-dark)"
                  type="number"
                  comparator={input.comparator}
                  onComparatorChange={(c) => onChange(input.ticks, c)}
                  value={input.ticks?.toString() ?? ''}
                  onChange={(e) => {
                    const v = parseInt(e.target.value);
                    onChange(isNaN(v) ? null : v, input.comparator);
                  }}
                />
              ) : (
                <TickInput
                  comparator
                  label={filterDef.label}
                  id={`filters-custom-${id}`}
                  initialComparator={input.comparator}
                  initialTicks={input.ticks ?? undefined}
                  inputMode={
                    filterDef.inputKind === 'ticks' ? 'ticks' : undefined
                  }
                  labelBg="var(--blert-surface-dark)"
                  onChange={onChange}
                  round={filterDef.round}
                />
              )}
              <button
                className={styles.remove}
                onClick={removeFilter}
                type="button"
              >
                <i className="fas fa-times" />
                <label className="sr-only">
                  Remove filter {filterDef.label}
                </label>
              </button>
            </div>
          );
        })}
      </div>
    </form>
  );
}

function CollapsibleList({
  items,
  onSelection,
  searchTerm = '',
  level = 0,
}: {
  items: MenuItem[];
  onSelection: (split: number) => void;
  searchTerm?: string;
  level?: number;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const itemMatchesSearch = (item: MenuItem, term: string): boolean => {
    if (term === '') {
      return true;
    }

    if (item.label.toLowerCase().includes(term.toLowerCase())) {
      return true;
    }

    if (item.subMenu) {
      return item.subMenu.some((subItem) => itemMatchesSearch(subItem, term));
    }

    return false;
  };

  const filteredItems = items
    .map((item) => {
      if (!itemMatchesSearch(item, searchTerm)) {
        return null;
      }

      if (!item.subMenu) {
        return item;
      }

      const itemDirectlyMatches = item.label
        .toLowerCase()
        .includes(searchTerm.toLowerCase());

      if (itemDirectlyMatches) {
        return item;
      }

      const filteredSubMenu = item.subMenu
        .map((subItem) => {
          if (!itemMatchesSearch(subItem, searchTerm)) {
            return null;
          }

          if (!subItem.subMenu) {
            return subItem;
          }

          // If subItem directly matches, show all its children.
          const subItemDirectlyMatches = subItem.label
            .toLowerCase()
            .includes(searchTerm.toLowerCase());

          if (subItemDirectlyMatches) {
            return subItem;
          }

          const filteredSubSubMenu = subItem.subMenu.filter((subSubItem) =>
            itemMatchesSearch(subSubItem, searchTerm),
          );

          return filteredSubSubMenu.length > 0
            ? { ...subItem, subMenu: filteredSubSubMenu }
            : null;
        })
        .filter(Boolean) as MenuItem[];

      return filteredSubMenu.length > 0
        ? { ...item, subMenu: filteredSubMenu }
        : null;
    })
    .filter(Boolean) as MenuItem[];

  const shouldExpand = searchTerm.length > 0;

  return (
    <ul
      className={`${styles.customFiltersList} ${styles[`level${level}`] || ''}`}
    >
      {filteredItems.map((item) => {
        const itemKey = `${level}-${item.label}`;
        const isExpanded = shouldExpand || open[itemKey] || false;

        const element = item.subMenu ? (
          <button
            className={styles.collapsible}
            onClick={() =>
              setOpen((prev) => ({
                ...prev,
                [itemKey]: !prev[itemKey],
              }))
            }
          >
            <i className={`fas fa-folder${isExpanded ? '-open' : ''}`} />
            {item.label}
            <i className={`fas fa-chevron-${isExpanded ? 'up' : 'down'}`} />
          </button>
        ) : (
          <button
            className={styles.filterItem}
            onClick={() => onSelection(item.value! as number)}
          >
            <i className="fas fa-plus" />
            {item.label}
          </button>
        );

        return (
          <li key={item.label}>
            {element}
            {item.subMenu && isExpanded && (
              <CollapsibleList
                items={item.subMenu}
                onSelection={onSelection}
                searchTerm={
                  item.label.toLowerCase().includes(searchTerm.toLowerCase())
                    ? '' // Don't filter children if parent directly matched.
                    : searchTerm
                }
                level={level + 1}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

function CustomFiltersModal({
  open,
  onClose,
  onSelection,
}: {
  open: boolean;
  onClose: () => void;
  onSelection: (split: number) => void;
}) {
  const [searchTerm, setSearchTerm] = useState('');

  React.useEffect(() => {
    if (open) {
      setSearchTerm('');
    }
  }, [open]);

  return (
    <Modal className={styles.customFiltersModal} onClose={onClose} open={open}>
      <div className={styles.modalHeader}>
        <h2>Add Custom Filter</h2>
        <button className={styles.closeButton} onClick={onClose} type="button">
          <i className="fas fa-times" />
          <span className="sr-only">Close</span>
        </button>
      </div>

      <div className={styles.searchWrapper}>
        <div className={styles.searchInput}>
          <i className="fas fa-search" />
          <input
            type="text"
            placeholder="Search filters..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            autoFocus
          />
          {searchTerm && (
            <button
              className={styles.clearSearch}
              onClick={() => setSearchTerm('')}
              type="button"
            >
              <i className="fas fa-times" />
            </button>
          )}
        </div>
      </div>

      <div className={styles.customFiltersContent}>
        {searchTerm && (
          <div className={styles.searchInfo}>
            Showing filters matching &quot;{searchTerm}&quot;
          </div>
        )}
        <CollapsibleList
          items={CUSTOM_FILTERS_ITEMS}
          searchTerm={searchTerm}
          onSelection={(value) => {
            onSelection(value);
            onClose();
          }}
        />
      </div>

      <div className={styles.modalFooter}>
        <Button simple onClick={onClose}>
          Cancel
        </Button>
      </div>
    </Modal>
  );
}
