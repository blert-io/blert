import {
  ChallengeMode,
  ChallengeStatus,
  ChallengeType,
  SplitType,
  Stage,
  splitName,
} from '@blert/common';
import React, { Dispatch, SetStateAction, useContext, useState } from 'react';

import Button from '@/components/button';
import Checkbox from '@/components/checkbox';
import DatePicker from '@/components/date-picker';
import Menu, { MenuItem } from '@/components/menu';
import Modal from '@/components/modal';
import PlayerSearch from '@/components/player-search';
import TagList from '@/components/tag-list';
import TickInput, { Comparator } from '@/components/tick-input';
import Tooltip from '@/components/tooltip';
import { DisplayContext } from '@/display';

import { SearchContext, SearchFilters } from './context';

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
                    ? context.filters.endDate ?? undefined
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
                        ? context.filters.startDate ?? undefined
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

const CUSTOM_FILTERS_ITEMS: MenuItem[] = [
  {
    label: 'Splits',
    subMenu: [
      {
        label: 'ToB',
        subMenu: [
          { label: 'Challenge time', value: SplitType.TOB_CHALLENGE },
          { label: 'Overall time', value: SplitType.TOB_OVERALL },
          {
            label: 'Maiden',
            subMenu: [
              { label: 'Room time', value: SplitType.TOB_MAIDEN },
              { label: '70s spawn', value: SplitType.TOB_MAIDEN_70S },
              { label: '50s spawn', value: SplitType.TOB_MAIDEN_50S },
              { label: '30s spawn', value: SplitType.TOB_MAIDEN_30S },
              { label: '70s-50s push', value: SplitType.TOB_MAIDEN_70S_50S },
              { label: '50s-30s push', value: SplitType.TOB_MAIDEN_50S_30S },
              { label: '30s-end', value: SplitType.TOB_MAIDEN_30S_END },
            ],
          },
          {
            label: 'Bloat time',
            value: SplitType.TOB_BLOAT,
          },
          {
            label: 'Nylocas',
            subMenu: [
              { label: 'Room time', value: SplitType.TOB_NYLO_ROOM },
              { label: 'Boss spawn', value: SplitType.TOB_NYLO_BOSS_SPAWN },
              { label: 'Boss time', value: SplitType.TOB_NYLO_BOSS },
            ],
          },
          {
            label: 'Sotetseg',
            subMenu: [
              { label: 'Room time', value: SplitType.TOB_SOTETSEG },
              { label: 'Maze 1 proc', value: SplitType.TOB_SOTETSEG_66 },
              { label: 'Maze 1 time', value: SplitType.TOB_SOTETSEG_MAZE_1 },
              { label: 'Maze 2 proc', value: SplitType.TOB_SOTETSEG_33 },
              { label: 'Maze 2 time', value: SplitType.TOB_SOTETSEG_MAZE_2 },
            ],
          },
          {
            label: 'Xarpus',
            subMenu: [
              { label: 'Room time', value: SplitType.TOB_XARPUS },
              { label: 'Screech time', value: SplitType.TOB_XARPUS_SCREECH },
            ],
          },
          {
            label: 'Verzik',
            subMenu: [
              { label: 'Room time', value: SplitType.TOB_VERZIK_ROOM },
              { label: 'P1 time', value: SplitType.TOB_VERZIK_P1 },
              { label: 'Reds spawn', value: SplitType.TOB_VERZIK_REDS },
              { label: 'P2 end', value: SplitType.TOB_VERZIK_P2_END },
              { label: 'P2 time', value: SplitType.TOB_VERZIK_P2 },
              { label: 'P3 time', value: SplitType.TOB_VERZIK_P3 },
            ],
          },
        ],
      },
      {
        label: 'Colosseum',
        subMenu: [
          { label: 'Wave 1 time', value: SplitType.COLOSSEUM_WAVE_1 },
          { label: 'Wave 2 time', value: SplitType.COLOSSEUM_WAVE_2 },
          { label: 'Wave 3 time', value: SplitType.COLOSSEUM_WAVE_3 },
          { label: 'Wave 4 time', value: SplitType.COLOSSEUM_WAVE_4 },
          { label: 'Wave 5 time', value: SplitType.COLOSSEUM_WAVE_5 },
          { label: 'Wave 6 time', value: SplitType.COLOSSEUM_WAVE_6 },
          { label: 'Wave 7 time', value: SplitType.COLOSSEUM_WAVE_7 },
          { label: 'Wave 8 time', value: SplitType.COLOSSEUM_WAVE_8 },
          { label: 'Wave 9 time', value: SplitType.COLOSSEUM_WAVE_9 },
          { label: 'Wave 10 time', value: SplitType.COLOSSEUM_WAVE_10 },
          { label: 'Wave 11 time', value: SplitType.COLOSSEUM_WAVE_11 },
          { label: 'Sol Heredit time', value: SplitType.COLOSSEUM_WAVE_12 },
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
  const [splitInputs, setSplitInputs] = useState<Record<string, SplitValues>>(
    () => {
      const inputs: Record<string, SplitValues> = {};
      Object.entries(context.filters.splits).forEach(
        ([split, [comparator, ticks]]) => {
          inputs[split] = { ticks, comparator };
        },
      );
      return inputs;
    },
  );
  const [modified, setModified] = useState(false);

  const addInput = (split: string | number) => {
    setModified(true);
    setSplitInputs((prev) => {
      if (prev[split] !== undefined) {
        return prev;
      }
      return {
        ...prev,
        [split]: {
          ticks: null,
          comparator: Comparator.EQUAL,
        },
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
      const next = { ...prev };
      next.filters.splits = {};
      Object.entries(splitInputs).forEach(([split, { ticks, comparator }]) => {
        if (ticks !== null) {
          next.filters.splits[split] = [comparator, ticks ?? 0];
        }
      });
      next.pagination = {};
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
        {Object.keys(splitInputs).map((s) => {
          const split = Number(s) as SplitType;
          const name = splitName(split, true);
          const round =
            split === SplitType.TOB_NYLO_BOSS_SPAWN ||
            split === SplitType.TOB_NYLO_BOSS
              ? 4
              : 1;

          return (
            <div key={split} className={styles.customInput}>
              <TickInput
                comparator
                label={name}
                id={`filters-split-${split}`}
                initialComparator={splitInputs[split]?.comparator}
                initialTicks={splitInputs[split]?.ticks ?? undefined}
                onChange={(ticks, comparator) => {
                  setModified(true);
                  setSplitInputs((prev) => ({
                    ...prev,
                    [split]: { ticks, comparator },
                  }));
                }}
                round={round}
              />
              <button
                className={styles.remove}
                onClick={() => {
                  setModified(true);
                  setSplitInputs((prev) => {
                    const next = { ...prev };
                    delete next[split];
                    return next;
                  });
                }}
                type="button"
              >
                <i className="fas fa-times" />
                <label className="sr-only">Remove filter {name}</label>
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
