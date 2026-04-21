import {
  ChallengeStatus,
  ChallengeType,
  SplitType,
  Stage,
} from '@blert/common';
import {
  Dispatch,
  SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import Checkbox from '@/components/checkbox';
import ComparableInput, { Comparator } from '@/components/comparable-input';
import Menu, { MenuItem } from '@/components/menu';
import TickInput from '@/components/tick-input';
import { GLOBAL_TOOLTIP_ID } from '@/components/tooltip';
import { oxford } from '@/utils/copy';

import {
  DateRangeFilter,
  FilterField,
  FilterRow,
  FilterSection,
  PartyFilter,
  ScaleFilter,
  StatusFilter,
  TypeFilter,
} from '../filter-controls';

import {
  SearchContext,
  SearchFilters,
  defaultSearchFilters,
  hasMokhaiotlFilters,
  hasTobFilters,
} from './context';

import styles from './style.module.scss';

const DATE_INPUT_WIDTH = 140;

type FiltersProps = {
  context: SearchContext;
  setContext: Dispatch<SetStateAction<SearchContext>>;
  loading: boolean;
};

const STATUS_OPTIONS = [
  { value: ChallengeStatus.IN_PROGRESS, label: 'In Progress' },
  { value: ChallengeStatus.COMPLETED, label: 'Completion' },
  { value: ChallengeStatus.WIPED, label: 'Wipe' },
  { value: ChallengeStatus.RESET, label: 'Reset' },
];

export function resetChallengeFilters(prev: SearchContext): SearchContext {
  return {
    ...prev,
    filters: defaultSearchFilters(),
    pagination: {},
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
  const [stageMenuOpen, setStageMenuOpen] = useState(false);
  const [stageOperatorMenuOpen, setStageOperatorMenuOpen] = useState(false);

  const [stageOperator, setStageOperator] = useState(
    context.filters.stage?.[0] ?? Comparator.EQUAL,
  );
  const selectedStage = context.filters.stage?.[1] ?? null;

  function updateFilters(update: Partial<SearchFilters>) {
    setContext((prev) => ({
      ...prev,
      filters: { ...prev.filters, ...update },
      pagination: {},
    }));
  }

  const allowedTypes: ChallengeType[] = [];
  const restrictions: string[] = [];
  if (hasTobFilters(context.filters.tob)) {
    allowedTypes.push(ChallengeType.TOB);
    restrictions.push('ToB-only');
  }
  if (hasMokhaiotlFilters(context.filters.mokhaiotl)) {
    allowedTypes.push(ChallengeType.MOKHAIOTL);
    restrictions.push('Mokhaiotl-only');
  }
  const restrictionMessage =
    restrictions.length > 0
      ? `Clear ${oxford(restrictions)} filters to change challenge type`
      : undefined;

  return (
    <div className={styles.filters}>
      <FilterRow>
        <TypeFilter
          type={context.filters.type}
          mode={context.filters.mode}
          onChange={(type, mode) => updateFilters({ type, mode })}
          disabled={loading}
          allowedTypes={allowedTypes.length > 0 ? allowedTypes : undefined}
          restrictionMessage={restrictionMessage}
        />
        <ScaleFilter
          scale={context.filters.scale}
          type={context.filters.type}
          onChange={(scale) => updateFilters({ scale })}
          disabled={loading}
        />
      </FilterRow>

      <FilterRow>
        <StatusFilter
          status={context.filters.status}
          options={STATUS_OPTIONS}
          onChange={(status) => updateFilters({ status })}
          disabled={loading}
        />
        <FilterField label="Options">
          <div
            data-tooltip-id={GLOBAL_TOOLTIP_ID}
            data-tooltip-content="When sorting by split times, exclude those which are inaccurate."
          >
            <Checkbox
              checked={context.filters.accurateSplits}
              disabled={loading}
              onChange={() =>
                updateFilters({
                  accurateSplits: !context.filters.accurateSplits,
                })
              }
              label="Accurate splits"
              simple
            />
          </div>
          <div
            data-tooltip-id={GLOBAL_TOOLTIP_ID}
            data-tooltip-content="Exclude challenges that are missing data for any stage."
          >
            <Checkbox
              checked={context.filters.fullRecordings}
              disabled={loading}
              onChange={() =>
                updateFilters({
                  fullRecordings: !context.filters.fullRecordings,
                })
              }
              label="Full recordings"
              simple
            />
          </div>
        </FilterField>
      </FilterRow>

      <FilterField label="Stage">
        <div className={styles.stageFilter}>
          <button
            id="stage-operator-select"
            onClick={() => setStageOperatorMenuOpen(true)}
            type="button"
            disabled={loading}
          >
            {STAGE_OPERATORS.find((op) => op.value === stageOperator)?.label ??
              'Select operator'}
            <i className="fas fa-chevron-down" style={{ marginLeft: 8 }} />
          </button>
          <button
            id="stage-select"
            onClick={() => setStageMenuOpen(true)}
            type="button"
            disabled={loading}
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
                updateFilters({ stage: [operator, selectedStage] });
              } else {
                updateFilters({ stage: null });
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
              updateFilters({ stage: [stageOperator, stage] });
            }}
            open={stageMenuOpen}
            items={STAGE_MENU_ITEMS}
            targetId="stage-select"
            width={DATE_INPUT_WIDTH}
          />
        </div>
      </FilterField>

      <DateRangeFilter
        startDate={context.filters.startDate}
        endDate={context.filters.endDate}
        onChange={(startDate, endDate) => updateFilters({ startDate, endDate })}
        disabled={loading}
      />

      <PartyFilter
        party={context.filters.party}
        onChange={(party) => updateFilters({ party })}
        disabled={loading}
      />

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

type BaseTarget = {
  inputKind: InputKind;
  min?: number;
  max?: number;
};

type ScalarTarget = {
  [P in ScalarFilterPaths<SearchFilters>]: {
    path: P;
  } & BaseTarget;
}[ScalarFilterPaths<SearchFilters>];

type KeyedTarget = {
  [P in KeyedFilterPaths<SearchFilters>]: {
    path: P;
    key: PathValue<SearchFilters, P> extends Map<infer K, FilterValue>
      ? K
      : PathValue<SearchFilters, P> extends Record<infer K, FilterValue>
        ? K
        : never;
  } & BaseTarget;
}[KeyedFilterPaths<SearchFilters>];

type FilterTarget = ScalarTarget | KeyedTarget;

type FilterDef = FilterTarget & {
  label: string;
  round?: number;
  min?: number;
  max?: number;
};

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
              min: 0,
              max: 20,
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
        label: 'Xarpus',
        subMenu: [
          {
            label: 'Healing',
            value: def('Xarpus healing', {
              path: 'tob.xarpusHealing',
              inputKind: 'number',
              min: 0,
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
    label: 'Mokhaiotl',
    subMenu: [
      {
        label: 'Deepest delve',
        value: def('Deepest delve', {
          path: 'mokhaiotl.maxCompletedDelve',
          inputKind: 'number',
          min: 0,
        }).id,
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
                label: 'Room entry',
                value: s('Nylo entry', SplitType.TOB_NYLO_START).id,
              },
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
                label: 'Room entry',
                value: s('Sote entry', SplitType.TOB_SOTETSEG_START).id,
              },
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
                label: 'Room entry',
                value: s('Xarpus entry', SplitType.TOB_XARPUS_START).id,
              },
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
                label: 'Room entry',
                value: s('Verzik entry', SplitType.TOB_VERZIK_START).id,
              },
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
            subMenu: [
              {
                label: 'Wave entry',
                value: s('Wave 3 entry', SplitType.COLOSSEUM_WAVE_3_START).id,
              },
              {
                label: 'Wave time',
                value: s('Wave 3', SplitType.COLOSSEUM_WAVE_3).id,
              },
            ],
          },
          {
            label: 'Wave 4',
            subMenu: [
              {
                label: 'Wave entry',
                value: s('Wave 4 entry', SplitType.COLOSSEUM_WAVE_4_START).id,
              },
              {
                label: 'Wave time',
                value: s('Wave 4', SplitType.COLOSSEUM_WAVE_4).id,
              },
            ],
          },
          {
            label: 'Wave 5',
            subMenu: [
              {
                label: 'Wave entry',
                value: s('Wave 5 entry', SplitType.COLOSSEUM_WAVE_5_START).id,
              },
              {
                label: 'Wave time',
                value: s('Wave 5', SplitType.COLOSSEUM_WAVE_5).id,
              },
            ],
          },
          {
            label: 'Wave 6',
            subMenu: [
              {
                label: 'Wave entry',
                value: s('Wave 6 entry', SplitType.COLOSSEUM_WAVE_6_START).id,
              },
              {
                label: 'Wave time',
                value: s('Wave 6', SplitType.COLOSSEUM_WAVE_6).id,
              },
            ],
          },
          {
            label: 'Wave 7',
            subMenu: [
              {
                label: 'Wave entry',
                value: s('Wave 7 entry', SplitType.COLOSSEUM_WAVE_7_START).id,
              },
              {
                label: 'Wave time',
                value: s('Wave 7', SplitType.COLOSSEUM_WAVE_7).id,
              },
            ],
          },
          {
            label: 'Wave 8',
            subMenu: [
              {
                label: 'Wave entry',
                value: s('Wave 8 entry', SplitType.COLOSSEUM_WAVE_8_START).id,
              },
              {
                label: 'Wave time',
                value: s('Wave 8', SplitType.COLOSSEUM_WAVE_8).id,
              },
            ],
          },
          {
            label: 'Wave 9',
            subMenu: [
              {
                label: 'Wave entry',
                value: s('Wave 9 entry', SplitType.COLOSSEUM_WAVE_9_START).id,
              },
              {
                label: 'Wave time',
                value: s('Wave 9', SplitType.COLOSSEUM_WAVE_9).id,
              },
            ],
          },
          {
            label: 'Wave 10',
            subMenu: [
              {
                label: 'Wave entry',
                value: s('Wave 10 entry', SplitType.COLOSSEUM_WAVE_10_START).id,
              },
              {
                label: 'Wave time',
                value: s('Wave 10', SplitType.COLOSSEUM_WAVE_10).id,
              },
            ],
          },
          {
            label: 'Wave 11',
            subMenu: [
              {
                label: 'Wave entry',
                value: s('Wave 11 entry', SplitType.COLOSSEUM_WAVE_11_START).id,
              },
              {
                label: 'Wave time',
                value: s('Wave 11', SplitType.COLOSSEUM_WAVE_11).id,
              },
            ],
          },
          {
            label: 'Sol Heredit',
            subMenu: [
              {
                label: 'Sol entry',
                value: s('Sol Heredit entry', SplitType.COLOSSEUM_WAVE_12_START)
                  .id,
              },
              {
                label: 'Sol time',
                value: s('Sol Heredit', SplitType.COLOSSEUM_WAVE_12).id,
              },
            ],
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
            subMenu: [
              {
                label: 'Delve entry',
                value: s('Delve 3 entry', SplitType.MOKHAIOTL_DELVE_3_START).id,
              },
              {
                label: 'Delve time',
                value: s('Delve 3', SplitType.MOKHAIOTL_DELVE_3).id,
              },
            ],
          },
          {
            label: 'Delve 4',
            subMenu: [
              {
                label: 'Delve entry',
                value: s('Delve 4 entry', SplitType.MOKHAIOTL_DELVE_4_START).id,
              },
              {
                label: 'Delve time',
                value: s('Delve 4', SplitType.MOKHAIOTL_DELVE_4).id,
              },
            ],
          },
          {
            label: 'Delve 5',
            subMenu: [
              {
                label: 'Delve entry',
                value: s('Delve 5 entry', SplitType.MOKHAIOTL_DELVE_5_START).id,
              },
              {
                label: 'Delve time',
                value: s('Delve 5', SplitType.MOKHAIOTL_DELVE_5).id,
              },
            ],
          },
          {
            label: 'Delve 6',
            subMenu: [
              {
                label: 'Delve entry',
                value: s('Delve 6 entry', SplitType.MOKHAIOTL_DELVE_6_START).id,
              },
              {
                label: 'Delve time',
                value: s('Delve 6', SplitType.MOKHAIOTL_DELVE_6).id,
              },
            ],
          },
          {
            label: 'Delve 7',
            subMenu: [
              {
                label: 'Delve entry',
                value: s('Delve 7 entry', SplitType.MOKHAIOTL_DELVE_7_START).id,
              },
              {
                label: 'Delve time',
                value: s('Delve 7', SplitType.MOKHAIOTL_DELVE_7).id,
              },
            ],
          },
          {
            label: 'Delve 8',
            subMenu: [
              {
                label: 'Delve entry',
                value: s('Delve 8 entry', SplitType.MOKHAIOTL_DELVE_8_START).id,
              },
              {
                label: 'Delve time',
                value: s('Delve 8', SplitType.MOKHAIOTL_DELVE_8).id,
              },
            ],
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

function cloneFiltersForCustomEdit(filters: SearchFilters): SearchFilters {
  return {
    ...filters,
    splits: new Map(filters.splits),
    tob: {
      ...filters.tob,
      bloatDowns: new Map(filters.tob.bloatDowns),
    },
    mokhaiotl: { ...filters.mokhaiotl },
  };
}

function filterValueEqual(
  a: [Comparator, number] | null,
  b: [Comparator, number] | null,
): boolean {
  if (a === null) {
    return b === null;
  }
  if (b === null) {
    return false;
  }
  return a[0] === b[0] && a[1] === b[1];
}

/**
 * Whether two filter sets are equal across every custom-filter path registered
 * in {@link FILTER_DEFS}.
 */
function customFiltersEqual(a: SearchFilters, b: SearchFilters): boolean {
  for (const filterDef of Object.values(FILTER_DEFS)) {
    if (
      !filterValueEqual(
        getFilterValue(a, filterDef),
        getFilterValue(b, filterDef),
      )
    ) {
      return false;
    }
  }
  return true;
}

function customFilterId(key: string): string {
  return `filters-custom-${key}`;
}

function CustomFilters({
  context,
  loading,
  setContext,
}: {
  context: SearchContext;
  loading: boolean;
  setContext: Dispatch<SetStateAction<SearchContext>>;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const customInputsFromFilters = useCallback((filters: SearchFilters) => {
    const inputs: Record<string, SplitValues> = {};
    for (const [id, filterDef] of Object.entries(FILTER_DEFS)) {
      const value = getFilterValue(filters, filterDef);
      if (value !== null) {
        inputs[id] = { ticks: value[1], comparator: value[0] };
      }
    }
    return inputs;
  }, []);
  const [customInputs, setCustomInputs] = useState<Record<string, SplitValues>>(
    () => customInputsFromFilters(context.filters),
  );
  const pendingScrollRef = useRef<string | null>(null);

  // Re-sync from URL changes (e.g. browser back/forward). Preserve the user's
  // insertion order — rebuilding from FILTER_DEFS would snap entries to their
  // registration order and cause them to jump around after a commit.
  useEffect(() => {
    setCustomInputs((prev) => {
      const fromContext = customInputsFromFilters(context.filters);
      const next: Record<string, SplitValues> = {};

      for (const [id, input] of Object.entries(prev)) {
        if (FILTER_DEFS[id] === undefined) {
          continue;
        }
        if (id in fromContext) {
          next[id] = fromContext[id];
        } else if (input.ticks === null) {
          next[id] = input;
        }
      }

      // Any context entries that weren't already in prev (e.g. loaded from URL
      // on initial mount) go at the end in FILTER_DEFS order.
      for (const [id, input] of Object.entries(fromContext)) {
        if (!(id in next)) {
          next[id] = input;
        }
      }

      return next;
    });
  }, [context.filters, customInputsFromFilters]);

  // After a filter is added (or re-selected), scroll it into view and focus
  // its input so the user can start typing immediately.
  useEffect(() => {
    const key = pendingScrollRef.current;
    if (key === null) {
      return;
    }
    pendingScrollRef.current = null;
    const raf = requestAnimationFrame(() => {
      const id = customFilterId(key);
      const field = document.querySelector<HTMLElement>(
        `[data-field-id="${id}"]`,
      );
      field?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      const input = document.getElementById(id);
      input?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(raf);
  }, [customInputs]);

  const commitAll = useCallback(
    (inputs: Record<string, SplitValues>) => {
      setContext((prev) => {
        const filters = cloneFiltersForCustomEdit(prev.filters);
        for (const [id, filterDef] of Object.entries(FILTER_DEFS)) {
          const input = inputs[id];
          // eslint-disable-next-line @typescript-eslint/prefer-optional-chain
          if (input === undefined || input.ticks === null) {
            setFilterValue(filters, filterDef, null);
          } else {
            setFilterValue(filters, filterDef, [input.comparator, input.ticks]);
          }
        }
        if (customFiltersEqual(prev.filters, filters)) {
          return prev;
        }
        return { ...prev, filters, pagination: {} };
      });
    },
    [setContext],
  );

  const stageInputChange = (id: string) => {
    return (ticks: number | null, cmp?: Comparator) => {
      const prevComparator = customInputs[id]?.comparator ?? Comparator.EQUAL;
      const comparator = cmp ?? prevComparator;
      const next = { ...customInputs, [id]: { ticks, comparator } };
      setCustomInputs(next);
      // Only a genuine comparator change is discrete; TickInput re-emits its
      // current comparator on every keystroke.
      if (cmp !== undefined && cmp !== prevComparator) {
        commitAll(next);
      }
    };
  };

  const commitInput = (id: string) => {
    return (ticks: number | null, cmp?: Comparator) => {
      const comparator =
        cmp ?? customInputs[id]?.comparator ?? Comparator.EQUAL;
      const next = { ...customInputs, [id]: { ticks, comparator } };
      setCustomInputs(next);
      commitAll(next);
    };
  };

  const handleAdd = (id: string | number) => {
    const key = String(id);
    pendingScrollRef.current = key;
    if (customInputs[key] !== undefined) {
      // Already exists; force an effect run so we still scroll to it.
      setCustomInputs({ ...customInputs });
      return;
    }
    setCustomInputs({
      ...customInputs,
      [key]: { ticks: null, comparator: Comparator.EQUAL },
    });
  };

  const handleRemove = (id: string) => {
    const next = { ...customInputs };
    delete next[id];
    setCustomInputs(next);
    commitAll(next);
  };

  const addButton = (
    <>
      <button
        id="filters-add-custom"
        className={styles.addFilter}
        onClick={() => setTimeout(() => setMenuOpen(true), 25)}
        type="button"
        disabled={loading}
      >
        <i className="fas fa-plus" aria-hidden />
        <span>Add</span>
      </button>
      <Menu
        onClose={() => setMenuOpen(false)}
        onSelection={handleAdd}
        open={menuOpen}
        items={CUSTOM_FILTERS_ITEMS}
        targetId="filters-add-custom"
        width="auto"
        cascadeDirection="left"
      />
    </>
  );

  return (
    <FilterSection title="Custom filters" action={addButton}>
      {Object.keys(customInputs).map((id) => {
        const filterDef = FILTER_DEFS[id];
        if (filterDef === undefined) {
          return null;
        }

        const input = customInputs[id];
        const stage = stageInputChange(id);
        const commit = commitInput(id);

        const fieldId = customFilterId(id);

        return (
          <FilterField
            key={id}
            label={filterDef.label}
            htmlFor={fieldId}
            fieldId={fieldId}
            onRemove={() => handleRemove(id)}
          >
            {filterDef.inputKind === 'number' ? (
              <ComparableInput
                id={fieldId}
                label={filterDef.label}
                labelBg="var(--blert-filter-surface)"
                type="number"
                comparator={input.comparator}
                onComparatorChange={(c) => commit(input.ticks, c)}
                value={input.ticks?.toString() ?? ''}
                min={filterDef.min}
                max={filterDef.max}
                onChange={(e) => {
                  const v = parseInt(e.target.value);
                  stage(isNaN(v) ? null : v);
                }}
                onBlur={() => commitAll(customInputs)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    commitAll(customInputs);
                  }
                }}
              />
            ) : (
              <TickInput
                comparator
                label={filterDef.label}
                id={fieldId}
                initialComparator={input.comparator}
                initialTicks={input.ticks ?? undefined}
                inputMode={
                  filterDef.inputKind === 'ticks' ? 'ticks' : undefined
                }
                labelBg="var(--blert-filter-surface)"
                onChange={stage}
                onBlur={commit}
                onConfirm={commit}
                round={filterDef.round}
              />
            )}
          </FilterField>
        );
      })}
    </FilterSection>
  );
}
