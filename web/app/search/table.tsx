'use client';

import { SplitType } from '@blert/common';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Dispatch,
  SetStateAction,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  ChallengeOverview,
  ExtraChallengeFields,
  SortQuery,
  SortableFields,
} from '@/actions/challenge';
import Button from '@/components/button';
import Input from '@/components/input';
import Modal from '@/components/modal';
import Menu, { MENU_DIVIDER, MenuItem } from '@/components/menu';
import { DisplayContext } from '@/display';
import { modeNameAndColor, statusNameAndColor } from '@/utils/challenge';
import { ticksToFormattedSeconds } from '@/utils/tick';
import { challengeUrl } from '@/utils/url';

import { SearchContext } from './context';

import styles from './style.module.scss';

const enum Column {
  UUID,
  DATE,
  TYPE,
  STATUS,
  SCALE,
  PARTY,
  CHALLENGE_TIME,
  OVERALL_TIME,
  TOTAL_DEATHS,

  // Split columns.
  MAIDEN_ROOM,
  MAIDEN_70S,
  MAIDEN_50S,
  MAIDEN_30S,
  BLOAT_ROOM,
  NYLOCAS_ROOM,
  NYLOCAS_BOSS_SPAWN,
  NYLOCAS_BOSS,
  SOTETSEG_ROOM,
  SOTETSEG_66,
  SOTETSEG_33,
  XARPUS_ROOM,
  XARPUS_SCREECH,
  VERZIK_ROOM,
  VERZIK_P1,
  VERZIK_P2,
  VERZIK_P3,
  INFERNO_WAVE_9,
  INFERNO_WAVE_18,
  INFERNO_WAVE_25,
  INFERNO_WAVE_35,
  INFERNO_WAVE_42,
  INFERNO_WAVE_50,
  INFERNO_WAVE_57,
  INFERNO_WAVE_60,
  INFERNO_WAVE_63,
  INFERNO_WAVE_66,
  INFERNO_WAVE_68,
  INFERNO_WAVE_69,
  COLOSSEUM_WAVE_1,
  COLOSSEUM_WAVE_2,
  COLOSSEUM_WAVE_3,
  COLOSSEUM_WAVE_4,
  COLOSSEUM_WAVE_5,
  COLOSSEUM_WAVE_6,
  COLOSSEUM_WAVE_7,
  COLOSSEUM_WAVE_8,
  COLOSSEUM_WAVE_9,
  COLOSSEUM_WAVE_10,
  COLOSSEUM_WAVE_11,
  COLOSSEUM_WAVE_12,
  MOKHAIOTL_DELVE_1,
  MOKHAIOTL_DELVE_2,
  MOKHAIOTL_DELVE_3,
  MOKHAIOTL_DELVE_4,
  MOKHAIOTL_DELVE_5,
  MOKHAIOTL_DELVE_6,
  MOKHAIOTL_DELVE_7,
  MOKHAIOTL_DELVE_8,

  MOKHAIOTL_DELVE,
  MOKHAIOTL_MAX_COMPLETED_DELVE,
}

type ColumnRenderer = (challenge: ChallengeOverview) => React.ReactNode;
type ColumnExtraFieldsToggler = (
  existing: ExtraChallengeFields,
  add: boolean,
) => ExtraChallengeFields;

type ColumnInfo = {
  name: string;
  fullName?: string;
  renderer: ColumnRenderer;
  toggleFields?: ColumnExtraFieldsToggler;
  align?: 'left' | 'right' | 'center';
  width?: number;
  sortKey?: SortableFields;
};

type PickType<T, U> = Pick<
  T,
  {
    [K in keyof Required<T>]: T[K] extends U ? K : never;
  }[keyof T]
>;

function valueRenderer(
  field: keyof PickType<ChallengeOverview, string | number>,
): ColumnRenderer {
  return (challenge) => challenge[field];
}

function ticksRenderer(
  field: keyof PickType<ChallengeOverview, number | null>,
): ColumnRenderer {
  return (challenge) =>
    challenge[field] !== null
      ? ticksToFormattedSeconds(challenge[field]!)
      : '-';
}

function splitsRenderer(type: SplitType): ColumnRenderer {
  return (challenge) => {
    const split = challenge.splits?.[type];
    if (split === undefined) {
      return '-';
    }
    const ticks = ticksToFormattedSeconds(split.ticks);
    return `${!split.accurate ? '*' : ''}${ticks}`;
  };
}

function toggleSplitField(type: SplitType): ColumnExtraFieldsToggler {
  return (fields, add) => {
    const splits = fields.splits ?? [];
    if (add) {
      if (splits.includes(type)) {
        return fields;
      }
      return { ...fields, splits: [...splits, type] };
    }
    return { ...fields, splits: splits.filter((s) => s !== type) };
  };
}

const includeStats: ColumnExtraFieldsToggler = (fields, add) => {
  if (add) {
    return { ...fields, stats: true };
  }
  return fields;
};

function splitColumn(
  name: string,
  type: SplitType,
  width: number,
  fullName?: string,
): ColumnInfo {
  return {
    name,
    fullName,
    align: 'right',
    renderer: splitsRenderer(type),
    toggleFields: toggleSplitField(type),
    width,
    sortKey: `splits:${type}`,
  };
}

const COLUMNS: { [key in Column]: ColumnInfo } = {
  [Column.UUID]: {
    name: '', // Intentionally empty.
    renderer: (challenge) => (
      <Link
        className={styles.id}
        href={challengeUrl(challenge.type, challenge.uuid)}
      >
        {challenge.uuid.substring(0, 6)}
      </Link>
    ),
    width: 75,
  },
  [Column.DATE]: {
    name: 'Date',
    renderer: (challenge) => {
      const date = challenge.startTime;
      return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
    },
    width: 110,
    sortKey: 'startTime',
  },
  [Column.TYPE]: {
    name: 'Type',
    renderer: (challenge) => {
      const [type, color] = modeNameAndColor(
        challenge.type,
        challenge.mode,
        false,
        true,
      );
      return <span style={{ color }}>{type}</span>;
    },
  },
  [Column.STATUS]: {
    name: 'Status',
    renderer: (challenge) => {
      const [status, color] = statusNameAndColor(
        challenge.status,
        challenge.stage,
      );
      return <span style={{ color }}>{status}</span>;
    },
    width: 150,
  },
  [Column.SCALE]: {
    name: 'Scale',
    align: 'right',
    renderer: (challenge) => challenge.party.length,
    sortKey: 'scale',
  },
  [Column.PARTY]: {
    name: 'Party',
    renderer: (challenge) => challenge.party.map((p) => p.username).join(', '),
    width: 400,
  },
  [Column.CHALLENGE_TIME]: {
    name: 'Challenge',
    fullName: 'Challenge Time',
    align: 'right',
    renderer: ticksRenderer('challengeTicks'),
    sortKey: 'challengeTicks',
    width: 120,
  },
  [Column.OVERALL_TIME]: {
    name: 'Overall',
    fullName: 'Overall Time',
    align: 'right',
    renderer: ticksRenderer('overallTicks'),
    sortKey: 'overallTicks',
    width: 100,
  },
  [Column.TOTAL_DEATHS]: {
    name: 'Deaths',
    fullName: 'Total Deaths',
    align: 'right',
    renderer: valueRenderer('totalDeaths'),
    sortKey: 'totalDeaths',
  },
  [Column.MAIDEN_ROOM]: splitColumn(
    'Maiden',
    SplitType.TOB_MAIDEN,
    100,
    'Maiden Time',
  ),
  [Column.MAIDEN_70S]: splitColumn(
    'Maiden - 70s',
    SplitType.TOB_MAIDEN_70S,
    130,
  ),
  [Column.MAIDEN_50S]: splitColumn(
    'Maiden - 50s',
    SplitType.TOB_MAIDEN_50S,
    130,
  ),
  [Column.MAIDEN_30S]: splitColumn(
    'Maiden - 30s',
    SplitType.TOB_MAIDEN_30S,
    130,
  ),
  [Column.BLOAT_ROOM]: splitColumn(
    'Bloat',
    SplitType.TOB_BLOAT,
    100,
    'Bloat Time',
  ),
  [Column.NYLOCAS_ROOM]: splitColumn(
    'Nylocas',
    SplitType.TOB_NYLO_ROOM,
    100,
    'Nylocas Time',
  ),
  [Column.NYLOCAS_BOSS_SPAWN]: splitColumn(
    'Nylo - Boss Spawn',
    SplitType.TOB_NYLO_BOSS_SPAWN,
    170,
    'Nylocas - Boss Spawn',
  ),
  [Column.NYLOCAS_BOSS]: splitColumn(
    'Nylo - Boss Time',
    SplitType.TOB_NYLO_BOSS,
    120,
    'Nylocas - Boss Time',
  ),
  [Column.SOTETSEG_ROOM]: splitColumn(
    'Sotetseg',
    SplitType.TOB_SOTETSEG,
    100,
    'Sotetseg Time',
  ),
  [Column.SOTETSEG_66]: splitColumn(
    'Sote - 66%',
    SplitType.TOB_SOTETSEG_66,
    120,
    'Sotetseg - 66%',
  ),
  [Column.SOTETSEG_33]: splitColumn(
    'Sote - 33%',
    SplitType.TOB_SOTETSEG_33,
    120,
    'Sotetseg - 33%',
  ),
  [Column.XARPUS_ROOM]: splitColumn(
    'Xarpus',
    SplitType.TOB_XARPUS,
    100,
    'Xarpus Time',
  ),
  [Column.XARPUS_SCREECH]: splitColumn(
    'Xarp - Screech',
    SplitType.TOB_XARPUS_SCREECH,
    150,
    'Xarpus - Screech',
  ),
  [Column.VERZIK_ROOM]: splitColumn(
    'Verzik',
    SplitType.TOB_VERZIK_ROOM,
    100,
    'Verzik Time',
  ),
  [Column.VERZIK_P1]: splitColumn('Verzik - P1', SplitType.TOB_VERZIK_P1, 120),
  [Column.VERZIK_P2]: splitColumn('Verzik - P2', SplitType.TOB_VERZIK_P2, 120),
  [Column.VERZIK_P3]: splitColumn('Verzik - P3', SplitType.TOB_VERZIK_P3, 120),
  [Column.INFERNO_WAVE_9]: splitColumn(
    'Inferno - W9',
    SplitType.INFERNO_WAVE_9_START,
    100,
    'Inferno - Wave 9',
  ),
  [Column.INFERNO_WAVE_18]: splitColumn(
    'Inferno - W18',
    SplitType.INFERNO_WAVE_18_START,
    100,
    'Inferno - Wave 18',
  ),
  [Column.INFERNO_WAVE_25]: splitColumn(
    'Inferno - W25',
    SplitType.INFERNO_WAVE_25_START,
    100,
    'Inferno - Wave 25',
  ),
  [Column.INFERNO_WAVE_35]: splitColumn(
    'Inferno - W35',
    SplitType.INFERNO_WAVE_35_START,
    100,
    'Inferno - Wave 35',
  ),
  [Column.INFERNO_WAVE_42]: splitColumn(
    'Inferno - W42',
    SplitType.INFERNO_WAVE_42_START,
    100,
    'Inferno - Wave 42',
  ),
  [Column.INFERNO_WAVE_50]: splitColumn(
    'Inferno - W50',
    SplitType.INFERNO_WAVE_50_START,
    100,
    'Inferno - Wave 50',
  ),
  [Column.INFERNO_WAVE_57]: splitColumn(
    'Inferno - W57',
    SplitType.INFERNO_WAVE_57_START,
    100,
    'Inferno - Wave 57',
  ),
  [Column.INFERNO_WAVE_60]: splitColumn(
    'Inferno - W60',
    SplitType.INFERNO_WAVE_60_START,
    100,
    'Inferno - Wave 60',
  ),
  [Column.INFERNO_WAVE_63]: splitColumn(
    'Inferno - W63',
    SplitType.INFERNO_WAVE_63_START,
    100,
    'Inferno - Wave 63',
  ),
  [Column.INFERNO_WAVE_66]: splitColumn(
    'Inferno - W66',
    SplitType.INFERNO_WAVE_66_START,
    100,
    'Inferno - Wave 66',
  ),
  [Column.INFERNO_WAVE_68]: splitColumn(
    'Inferno - W68',
    SplitType.INFERNO_WAVE_68_START,
    100,
    'Inferno - Wave 68',
  ),
  [Column.INFERNO_WAVE_69]: splitColumn(
    'Inferno - W69',
    SplitType.INFERNO_WAVE_69_START,
    100,
    'Inferno - Wave 69',
  ),
  [Column.COLOSSEUM_WAVE_1]: splitColumn(
    'Colo - W1',
    SplitType.COLOSSEUM_WAVE_1,
    100,
    'Colosseum - Wave 1',
  ),
  [Column.COLOSSEUM_WAVE_2]: splitColumn(
    'Colo - W2',
    SplitType.COLOSSEUM_WAVE_2,
    100,
    'Colosseum - Wave 2',
  ),
  [Column.COLOSSEUM_WAVE_3]: splitColumn(
    'Colo - W3',
    SplitType.COLOSSEUM_WAVE_3,
    100,
    'Colosseum - Wave 3',
  ),
  [Column.COLOSSEUM_WAVE_4]: splitColumn(
    'Colo - W4',
    SplitType.COLOSSEUM_WAVE_4,
    100,
    'Colosseum - Wave 4',
  ),
  [Column.COLOSSEUM_WAVE_5]: splitColumn(
    'Colo - W5',
    SplitType.COLOSSEUM_WAVE_5,
    100,
    'Colosseum - Wave 5',
  ),
  [Column.COLOSSEUM_WAVE_6]: splitColumn(
    'Colo - W6',
    SplitType.COLOSSEUM_WAVE_6,
    100,
    'Colosseum - Wave 6',
  ),
  [Column.COLOSSEUM_WAVE_7]: splitColumn(
    'Colo - W7',
    SplitType.COLOSSEUM_WAVE_7,
    100,
    'Colosseum - Wave 7',
  ),
  [Column.COLOSSEUM_WAVE_8]: splitColumn(
    'Colo - W8',
    SplitType.COLOSSEUM_WAVE_8,
    100,
    'Colosseum - Wave 8',
  ),
  [Column.COLOSSEUM_WAVE_9]: splitColumn(
    'Colo - W9',
    SplitType.COLOSSEUM_WAVE_9,
    100,
    'Colosseum - Wave 9',
  ),
  [Column.COLOSSEUM_WAVE_10]: splitColumn(
    'Colo - W10',
    SplitType.COLOSSEUM_WAVE_10,
    100,
    'Colosseum - Wave 10',
  ),
  [Column.COLOSSEUM_WAVE_11]: splitColumn(
    'Colo - W11',
    SplitType.COLOSSEUM_WAVE_11,
    100,
    'Colosseum - Wave 11',
  ),
  [Column.COLOSSEUM_WAVE_12]: splitColumn(
    'Sol Heredit',
    SplitType.COLOSSEUM_WAVE_12,
    100,
    'Sol Heredit Time',
  ),
  [Column.MOKHAIOTL_DELVE_1]: splitColumn(
    'Mok - D1',
    SplitType.MOKHAIOTL_DELVE_1,
    100,
    'Mokhaiotl - Delve 1',
  ),
  [Column.MOKHAIOTL_DELVE_2]: splitColumn(
    'Mok - D2',
    SplitType.MOKHAIOTL_DELVE_2,
    100,
    'Mokhaiotl - Delve 2',
  ),
  [Column.MOKHAIOTL_DELVE_3]: splitColumn(
    'Mok - D3',
    SplitType.MOKHAIOTL_DELVE_3,
    100,
    'Mokhaiotl - Delve 3',
  ),
  [Column.MOKHAIOTL_DELVE_4]: splitColumn(
    'Mok - D4',
    SplitType.MOKHAIOTL_DELVE_4,
    100,
    'Mokhaiotl - Delve 4',
  ),
  [Column.MOKHAIOTL_DELVE_5]: splitColumn(
    'Mok - D5',
    SplitType.MOKHAIOTL_DELVE_5,
    100,
    'Mokhaiotl - Delve 5',
  ),
  [Column.MOKHAIOTL_DELVE_6]: splitColumn(
    'Mok - D6',
    SplitType.MOKHAIOTL_DELVE_6,
    100,
    'Mokhaiotl - Delve 6',
  ),
  [Column.MOKHAIOTL_DELVE_7]: splitColumn(
    'Mok - D7',
    SplitType.MOKHAIOTL_DELVE_7,
    100,
    'Mokhaiotl - Delve 7',
  ),
  [Column.MOKHAIOTL_DELVE_8]: splitColumn(
    'Mok - D8',
    SplitType.MOKHAIOTL_DELVE_8,
    100,
    'Mokhaiotl - Delve 8',
  ),
  [Column.MOKHAIOTL_DELVE]: {
    name: 'Mok - Delve',
    fullName: 'Mokhaiotl Delve',
    align: 'right',
    renderer: (challenge) => challenge.mokhaiotlStats?.delve ?? '-',
    toggleFields: includeStats,
  },
  [Column.MOKHAIOTL_MAX_COMPLETED_DELVE]: {
    name: 'Mok - Completed',
    fullName: 'Mokhaiotl Completed',
    align: 'right',
    renderer: (challenge) => challenge.mokhaiotlStats?.maxCompletedDelve ?? '-',
    toggleFields: includeStats,
  },
};

type ContextMenu = {
  x: number;
  y: number;
  heading?: {
    column: Column;
  };
  challenge?: {
    index: number;
    column: Column;
  };
  multipleChallenges?: number[];
};

type SelectedColumn = {
  column: Column;
};

const UUID_COLUMN: SelectedColumn = { column: Column.UUID };
const DEFAULT_SELECTED_COLUMNS: SelectedColumn[] = [
  { column: Column.DATE },
  { column: Column.TYPE },
  { column: Column.STATUS },
  { column: Column.SCALE },
  { column: Column.PARTY },
  { column: Column.CHALLENGE_TIME },
  { column: Column.OVERALL_TIME },
];

type PresetStorage = {
  presets: PresetColumns[];
  activeColumns: SelectedColumn[];
};

class LocalStorageManager {
  private key: string;

  public constructor(key: string) {
    this.key = key;
  }

  public get(): PresetStorage {
    const data = localStorage.getItem(this.key);
    if (data === null) {
      return { presets: [], activeColumns: DEFAULT_SELECTED_COLUMNS };
    }

    try {
      return JSON.parse(data);
    } catch {
      return { presets: [], activeColumns: DEFAULT_SELECTED_COLUMNS };
    }
  }

  public set(
    presets: PresetStorage | ((prev: PresetStorage) => PresetStorage),
  ) {
    if (typeof presets === 'function') {
      const prev = this.get();
      localStorage.setItem(this.key, JSON.stringify(presets(prev)));
    } else {
      localStorage.setItem(this.key, JSON.stringify(presets));
    }
  }
}

const SEARCH_PRESETS_STORAGE_KEY = 'search-column-presets';
export const searchPresetsStorage = new LocalStorageManager(
  SEARCH_PRESETS_STORAGE_KEY,
);

/**
 * Returns the extra fields that should be loaded based on the selected columns.
 * @param columns List of selected columns.
 * @returns Additional fields to load.
 */
export function extraFieldsForColumns(
  columns: SelectedColumn[],
): ExtraChallengeFields {
  let extraFields: ExtraChallengeFields = {};
  for (const column of columns) {
    const toggleFields = COLUMNS[column.column].toggleFields;
    if (toggleFields !== undefined) {
      extraFields = toggleFields(extraFields, true);
    }
  }
  return extraFields;
}

type TableProps = {
  challenges: ChallengeOverview[];
  context: SearchContext;
  setContext: Dispatch<SetStateAction<SearchContext>>;
  loading: boolean;
  totalCount: number;
};

export default function Table(props: TableProps) {
  const router = useRouter();
  const display = useContext(DisplayContext);

  const tableRef = useRef<HTMLTableElement>(null);
  const headingRef = useRef<HTMLTableSectionElement>(null);

  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [columnsModalOpen, setColumnsModalOpen] = useState(false);

  const [selectedChallenges, setSelectedChallenges] = useState<number[]>([]);
  const [lastClickedChallenge, setLastClickedChallenge] = useState<
    [number, number] | null
  >(null);

  const isCompact = display.isCompact();

  useEffect(() => {
    const menuListener = (e: MouseEvent) => {
      if (tableRef.current?.contains(e.target as Node)) {
        e.preventDefault();

        let menuX: number;
        if (isCompact) {
          menuX = 60;
        } else {
          menuX =
            e.clientX + MENU_WIDTH >
            tableRef.current.getBoundingClientRect().right
              ? e.clientX - MENU_WIDTH + 5
              : e.clientX;
        }

        const menu: ContextMenu = {
          y: e.clientY,
          x: menuX,
        };

        let target: HTMLElement | null = e.target as HTMLElement;
        if (target.tagName !== 'TD' && target.tagName !== 'TH') {
          target = target.closest('td, th');
        }

        if (target === null) {
          return;
        }

        const [type, ...rest] = (target.dataset['context'] ?? '').split(':');
        switch (type) {
          case 'heading': {
            const column = Number.parseInt(rest[0]) as Column;
            menu.heading = { column };
            break;
          }

          case 'row': {
            const index = Number.parseInt(rest[0]);
            const column = Number.parseInt(rest[1]) as Column;

            if (selectedChallenges.length > 1) {
              menu.multipleChallenges = selectedChallenges;
            } else {
              menu.challenge = { index, column };
              setSelectedChallenges([index]);
            }
            break;
          }
        }

        setContextMenu(menu as ContextMenu);
      } else {
        setContextMenu(null);
      }
    };
    window.addEventListener('contextmenu', menuListener);
    return () => {
      window.removeEventListener('contextmenu', menuListener);
    };
  }, [selectedChallenges, isCompact]);

  const [selectedColumns, setSelectedColumns] = useState<SelectedColumn[]>(
    DEFAULT_SELECTED_COLUMNS,
  );

  useEffect(() => setSelectedChallenges([]), [props.challenges]);

  const { setContext } = props;

  const removeColumn = useCallback(
    (col: Column) => {
      const column = COLUMNS[col];
      setSelectedColumns((columns) => columns.filter((c) => c.column !== col));

      if (column.toggleFields) {
        setContext((context) => ({
          ...context,
          extraFields: column.toggleFields!(context.extraFields, false),
        }));
      }

      searchPresetsStorage.set((prev) => ({
        ...prev,
        activeColumns: prev.activeColumns.filter((c) => c.column !== col),
      }));
    },
    [setSelectedColumns, setContext],
  );

  const setAllColumns = useCallback(
    (columns: SelectedColumn[]) => {
      setSelectedColumns(columns);
      setContext((prev) => ({
        ...prev,
        extraFields: extraFieldsForColumns(columns),
      }));
      searchPresetsStorage.set((prev) => ({
        ...prev,
        activeColumns: columns,
      }));
    },
    [setContext],
  );

  const columnsModal = useMemo(
    () => (
      <ColumnsModal
        close={() => setColumnsModalOpen(false)}
        open={columnsModalOpen}
        selectedColumns={selectedColumns}
        setAllColumns={setAllColumns}
      />
    ),
    [columnsModalOpen, selectedColumns, setAllColumns],
  );

  const allColumns = [UUID_COLUMN, ...selectedColumns];

  return (
    <>
      <div className={styles.tableHeader}>
        <h3>
          <i className="fas fa-table" />
          Challenges
          <span className={styles.totalCount}>
            ({props.totalCount.toLocaleString()})
          </span>
        </h3>
      </div>
      <div className={styles.wrapper}>
        <table className={styles.table} ref={tableRef}>
          <thead ref={headingRef}>
            <tr>
              {allColumns.map((c) => {
                const column = COLUMNS[c.column];
                let content;

                if (props.context.sort && column.sortKey) {
                  const mainSort = props.context.sort[0];
                  let icon;
                  let nextSort: Array<SortQuery<SortableFields>>;
                  const currentSort = mainSort.slice(1);
                  if (currentSort === column.sortKey) {
                    icon = (
                      <i
                        className={`fas fa-sort-${mainSort[0] === '+' ? 'up' : 'down'}`}
                      />
                    );
                    nextSort =
                      mainSort[0] === '+'
                        ? [`-${column.sortKey}`]
                        : currentSort === 'startTime'
                          ? ['+startTime']
                          : ['-startTime'];
                  } else {
                    icon = <i className="fas fa-sort" />;
                    nextSort = [`+${column.sortKey}`];
                  }
                  content = (
                    <button
                      onClick={() =>
                        props.setContext((context) => ({
                          ...context,
                          sort: nextSort,
                          pagination: {},
                        }))
                      }
                    >
                      {column.name} {icon}
                    </button>
                  );
                } else {
                  content = <span>{column.name}</span>;
                }

                let width = column.width;
                if (width !== undefined && display.isCompact()) {
                  width = Math.floor(width * 0.9);
                }

                return (
                  <th
                    key={c.column}
                    data-context={`heading:${c.column}`}
                    style={{ width }}
                  >
                    {content}
                  </th>
                );
              })}
              <th className={styles.addColumns}>
                <button onClick={() => setColumnsModalOpen(true)}>
                  <i className="fas fa-plus" />
                  <span className="sr-only">Add columns</span>
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {props.challenges.map((challenge, i) => (
              <tr
                key={challenge.uuid}
                className={
                  selectedChallenges.includes(i) ? styles.selectedChallenge : ''
                }
                onClick={(e) => {
                  const now = Date.now();
                  if (lastClickedChallenge !== null) {
                    const [id, time] = lastClickedChallenge;
                    if (id === i && now - time < DOUBLE_CLICK_THRESHOLD) {
                      router.push(challengeUrl(challenge.type, challenge.uuid));
                      return;
                    }
                  }

                  setLastClickedChallenge([i, now]);

                  setSelectedChallenges((selected) => {
                    if (e.ctrlKey || e.metaKey) {
                      if (selected.includes(i)) {
                        return selected.filter((j) => j !== i);
                      }
                      return [...selected, i];
                    }

                    if (e.shiftKey) {
                      if (selected.length === 0) {
                        return [i];
                      }

                      const start = Math.min(selected[0], i);
                      const end = Math.max(selected[0], i);
                      return Array.from(
                        { length: end - start + 1 },
                        (_, j) => j + start,
                      );
                    }

                    if (selected.length > 1) {
                      return [i];
                    }

                    return selected[0] === i ? [] : [i];
                  });
                }}
              >
                {allColumns.map((c) => {
                  const column = COLUMNS[c.column];
                  const align = column.align ?? 'left';
                  let width = column.width;
                  if (width !== undefined && display.isCompact()) {
                    width = Math.floor(width * 0.9);
                  }
                  return (
                    <td
                      key={c.column}
                      data-context={`row:${i}:${c.column}`}
                      style={{ textAlign: align, width }}
                    >
                      {column.renderer(challenge)}
                    </td>
                  );
                })}
                <td style={{ width: 40, padding: 0 }} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {contextMenu && (
        <ContextMenu
          context={contextMenu}
          challenges={props.challenges}
          onClose={() => setContextMenu(null)}
          openColumnsModal={() => setColumnsModalOpen(true)}
          removeColumn={removeColumn}
          router={router}
          setContext={props.setContext}
        />
      )}
      {columnsModal}
    </>
  );
}

const DOUBLE_CLICK_THRESHOLD = 300;
const MENU_WIDTH = 300;

function ContextMenu({
  challenges,
  context,
  onClose,
  openColumnsModal,
  setContext,
  removeColumn,
  router,
}: {
  challenges: ChallengeOverview[];
  context: ContextMenu;
  onClose: () => void;
  openColumnsModal: () => void;
  setContext: Dispatch<SetStateAction<SearchContext>>;
  removeColumn: (col: Column) => void;
  router: ReturnType<typeof useRouter>;
}) {
  const items: MenuItem[] = [];

  if (context.multipleChallenges) {
    const allChallenges = context.multipleChallenges.map((i) => challenges[i]);

    items.push({
      label: `${context.multipleChallenges.length} challenges selected`,
    });
    items.push(MENU_DIVIDER);
    items.push({
      label: 'Copy IDs',
      customAction: () => {
        navigator.clipboard.writeText(
          allChallenges.map((c) => c.uuid).join('\n'),
        );
      },
    });
  }

  if (context.heading !== undefined) {
    const column = COLUMNS[context.heading.column];

    if (column.name !== '') {
      if (column.sortKey) {
        items.push({
          label: `Sort by ${column.fullName ?? column.name}`,
          icon: 'fas fa-arrow-up-wide-short',
          customAction: () =>
            setContext((context) => ({
              ...context,
              sort: [`+${column.sortKey!}`],
              pagination: {},
            })),
        });
        items.push({
          label: `Sort by ${column.fullName ?? column.name}`,
          icon: 'fas fa-arrow-down-wide-short',
          customAction: () =>
            setContext((context) => ({
              ...context,
              sort: [`-${column.sortKey!}`],
              pagination: {},
            })),
        });
      }

      if (items.length > 0) {
        items.push(MENU_DIVIDER);
      }

      items.push({
        label: `Remove column ${column.name}`,
        customAction: () => removeColumn(context.heading!.column),
      });
    }
    items.push({
      label: 'Manage columns…',
      customAction: openColumnsModal,
    });
  }

  if (context.challenge !== undefined) {
    const challenge = challenges[context.challenge.index];

    if (context.challenge.column === Column.PARTY) {
      items.push({
        label: challenge.party.map((p) => p.username).join(', '),
        wrap: true,
      });
      items.push(MENU_DIVIDER);
    }

    items.push({
      label: 'View challenge',
      customAction: () =>
        router.push(challengeUrl(challenge.type, challenge.uuid)),
    });

    items.push({
      label: 'Find similar challenges',
      customAction: () => {
        setContext((prev) => ({
          ...prev,
          filters: {
            ...prev.filters,
            party: challenge.party.map((p) => p.currentUsername),
            scale: [challenge.party.length],
            type: [challenge.type],
          },
        }));
      },
    });

    items.push({
      label: 'Copy URL',
      customAction: () => {
        navigator.clipboard.writeText(
          window.location.origin + challengeUrl(challenge.type, challenge.uuid),
        );
      },
    });
    items.push({
      label: 'Copy ID',
      customAction: () => {
        navigator.clipboard.writeText(challenge.uuid);
      },
    });
  }

  return (
    <Menu
      items={items}
      onClose={onClose}
      open
      position={context}
      width={MENU_WIDTH}
    />
  );
}

enum DraggingHighlight {
  NONE,
  HINT,
  ACTIVE,
}

type DraggingHighlights = [DraggingHighlight, DraggingHighlight];

const COLUMN_ENTRY_HEIGHT = 20;
const COLUMN_PADDING = 2;
const TOTAL_COLUMN_HEIGHT = COLUMN_ENTRY_HEIGHT + COLUMN_PADDING * 2;

type ConfirmAction = {
  message: string;
  action: () => void;
  customContent?: React.ReactNode;
  yesButton?: string;
  noButton?: string;
};

type PresetColumns = {
  name: string;
  id: number;
  columns: SelectedColumn[];
};

const DEFAULT_PRESET: PresetColumns = {
  name: 'Default',
  id: 0,
  columns: DEFAULT_SELECTED_COLUMNS,
};

function ColumnsModal({
  close,
  open,
  selectedColumns,
  setAllColumns,
}: {
  close: () => void;
  open: boolean;
  selectedColumns: SelectedColumn[];
  setAllColumns: (columns: SelectedColumn[]) => void;
}) {
  const [columns, setColumns] = useState<SelectedColumn[]>(selectedColumns);
  const [presets, setPresets] = useState<PresetColumns[]>([]);

  const [dragging, setDragging] = useState<Column | null>(null);
  const [lastClick, setLastClick] = useState<[Column, number] | null>(null);
  const [newIndex, setNewIndex] = useState<number | null>(null);

  const [[selectedHighlight, availableHighlight], setHighlights] =
    useState<DraggingHighlights>([
      DraggingHighlight.NONE,
      DraggingHighlight.NONE,
    ]);

  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(
    null,
  );

  const stopDragging = () => {
    setDragging(null);
    setNewIndex(null);
    setHighlights([DraggingHighlight.NONE, DraggingHighlight.NONE]);
  };

  useEffect(() => {
    setColumns(selectedColumns);
  }, [selectedColumns]);

  useEffect(() => {
    const presets = searchPresetsStorage.get();
    setPresets(presets.presets);
    if (presets.activeColumns) {
      setAllColumns(presets.activeColumns);
    }
  }, [setAllColumns]);

  const allPresets = [DEFAULT_PRESET, ...presets];

  const selectedRef = useRef<HTMLDivElement>(null);
  const availableRef = useRef<HTMLDivElement>(null);

  function columnListEntry(col: Column) {
    const column = COLUMNS[col];

    return (
      <div
        className={`${styles.column} ${col === dragging ? styles.selected : ''}`}
        key={col}
        onMouseDown={() => {
          const isSelected = columns.some((c) => c.column === col);

          if (lastClick !== null) {
            const [last, time] = lastClick;
            if (last === col && Date.now() - time < DOUBLE_CLICK_THRESHOLD) {
              if (isSelected) {
                setColumns(columns.filter((c) => c.column !== col));
              } else {
                setColumns([...columns, { column: col }]);
              }
              stopDragging();
              setLastClick(null);
              return;
            }
          }

          setDragging(col);
          setLastClick([col, Date.now()]);
        }}
        onMouseUp={() => {
          stopDragging();
        }}
        style={{
          height: TOTAL_COLUMN_HEIGHT,
          padding: `${COLUMN_PADDING}px 4px`,
        }}
      >
        {column.fullName ?? column.name}
      </div>
    );
  }

  function onMouseMove(e: React.MouseEvent) {
    if (dragging === null) {
      return;
    }

    const isSelected = columns.some((c) => c.column === dragging);

    let highlights: DraggingHighlights = [
      DraggingHighlight.NONE,
      DraggingHighlight.NONE,
    ];

    if (isSelected) {
      if (availableRef.current!.contains(e.target as Node)) {
        highlights[1] = DraggingHighlight.ACTIVE;
      }
    }

    if (selectedRef.current!.contains(e.target as Node)) {
      highlights = [DraggingHighlight.ACTIVE, DraggingHighlight.NONE];

      // Reorder columns.
      const rect = selectedRef.current!.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const index = Math.min(
        Math.max(Math.floor(y / TOTAL_COLUMN_HEIGHT), 0),
        columns.length,
      );
      setNewIndex(index);
    } else {
      setNewIndex(null);
    }

    setHighlights(highlights);
  }

  function onMouseUp(e: React.MouseEvent) {
    if (dragging === null) {
      return;
    }

    if (
      columns.some((c) => c.column === dragging) &&
      availableRef.current!.contains(e.target as Node)
    ) {
      setColumns(columns.filter((c) => c.column !== dragging));
    }

    if (newIndex !== null) {
      setColumns((existing) => {
        if (existing.some((c) => c.column === dragging)) {
          return [
            ...columns.slice(0, newIndex).filter((c) => c.column !== dragging),
            { column: dragging },
            ...columns.slice(newIndex).filter((c) => c.column !== dragging),
          ];
        }

        return [
          ...columns.slice(0, newIndex),
          { column: dragging },
          ...columns.slice(newIndex),
        ];

        return [];
      });
    }

    stopDragging();
  }

  useEffect(() => {
    window.addEventListener('mouseup', stopDragging);
    return () => window.removeEventListener('mouseup', stopDragging);
  }, [setDragging, setHighlights]);

  const modified =
    columns.length !== selectedColumns.length ||
    columns.some((c, i) => c !== selectedColumns[i]);

  function tryClose() {
    if (confirmAction !== null) {
      return;
    }
    if (modified) {
      setConfirmAction({
        message: 'Exit without saving?',
        action: () => {
          setColumns(selectedColumns);
          close();
        },
      });
    } else {
      close();
    }
  }

  function loadPreset(preset: PresetColumns) {
    setConfirmAction({
      message: `Load preset ${preset.name}?`,
      action: () => {
        setAllColumns(preset.columns);
      },
    });
  }

  const listClass = (highlight: DraggingHighlight) => {
    let className = styles.columnsList;
    if (dragging !== null) {
      className += ` ${styles.dragging}`;
      if (highlight === DraggingHighlight.HINT) {
        className += ` ${styles.hint}`;
      } else if (highlight === DraggingHighlight.ACTIVE) {
        className += ` ${styles.active}`;
      }
    }
    return className;
  };

  return (
    <Modal className={styles.columnsModal} open={open} onClose={tryClose}>
      <div className={styles.modalHeader}>
        <h2>Manage columns</h2>
        <button className={styles.closeButton} onClick={tryClose}>
          <i className="fas fa-times" />
        </button>
      </div>
      <div
        className={styles.selection}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
      >
        <div className={listClass(selectedHighlight)} ref={selectedRef}>
          <label className={styles.label}>
            <i className="fas fa-check-circle" />
            Selected
          </label>
          <div className={styles.listWrapper}>
            {columns
              .filter((c) => COLUMNS[c.column].name !== '')
              .map((c) => columnListEntry(c.column))}
            {newIndex !== null && (
              <div
                className={styles.insertion}
                style={{
                  position: 'absolute',
                  top: newIndex * (TOTAL_COLUMN_HEIGHT + 2),
                  left: '12px',
                  width: 'calc(100% - 24px)',
                }}
              >
                <i className="fas fa-caret-right" />
                <i className="fas fa-caret-left" />
              </div>
            )}
          </div>
        </div>
        <div className={listClass(availableHighlight)} ref={availableRef}>
          <label className={styles.label}>
            <i className="fas fa-plus-circle" />
            Available
          </label>
          <div className={styles.listWrapper}>
            {Object.keys(COLUMNS)
              .filter((key) => {
                const column = Number(key) as Column;
                return (
                  columns.every((c) => c.column !== column) &&
                  COLUMNS[column].name !== ''
                );
              })
              .map((key) => columnListEntry(Number(key) as Column))}
          </div>
        </div>
        <div className={styles.columnsList}>
          <label className={styles.label}>
            <i className="fas fa-bookmark" />
            Presets
          </label>
          <div className={styles.listWrapper}>
            {allPresets.map((preset) => (
              <div
                className={styles.column}
                key={preset.id}
                onClick={() => loadPreset(preset)}
                style={{
                  height: TOTAL_COLUMN_HEIGHT,
                  padding: `${COLUMN_PADDING}px 4px`,
                }}
              >
                <span>{preset.name}</span>
                {preset !== DEFAULT_PRESET && (
                  <i
                    className="fas fa-trash"
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmAction({
                        message: `Delete preset ${preset.name}?`,
                        action: () => {
                          setPresets((presets) =>
                            presets.filter((p) => p.id !== preset.id),
                          );
                        },
                      });
                    }}
                  />
                )}
              </div>
            ))}
            <div
              className={styles.column}
              style={{
                height: TOTAL_COLUMN_HEIGHT,
                padding: `${COLUMN_PADDING}px 4px`,
                opacity: 0.8,
              }}
              onClick={() => {
                setConfirmAction({
                  message: 'Save selected columns as preset?',
                  action: () => {
                    const input = document.getElementById('new-preset-name');
                    if (!input || !(input instanceof HTMLInputElement)) {
                      return;
                    }

                    const newPresets = [
                      ...presets,
                      {
                        name: input.value,
                        id: presets.length + 1,
                        columns,
                      },
                    ];
                    setPresets(newPresets);
                    searchPresetsStorage.set((prev) => ({
                      ...prev,
                      presets: newPresets,
                    }));
                  },
                  customContent: (
                    <div className={styles.presetInput}>
                      <Input
                        autoFocus
                        id="new-preset-name"
                        label="Preset name"
                        pattern="[a-zA-Z0-9 _-]{1,50}"
                        required
                      />
                    </div>
                  ),
                  yesButton: 'Save',
                  noButton: 'Cancel',
                });
              }}
            >
              <i className="fas fa-plus" />
              New Preset…
            </div>
          </div>
        </div>
      </div>
      <div className={styles.modalFooter}>
        <Button
          disabled={!modified}
          onClick={() => {
            setAllColumns(columns);
          }}
        >
          Accept
        </Button>
        <Button
          disabled={!modified}
          onClick={() => setColumns(selectedColumns)}
        >
          Reset
        </Button>
        <Button simple onClick={tryClose}>
          Close
        </Button>
      </div>
      {confirmAction && (
        <div className={styles.dimmer}>
          <form
            className={styles.confirm}
            onSubmit={() => {
              confirmAction.action();
              setConfirmAction(null);
            }}
          >
            <p className={styles.message}>{confirmAction.message}</p>
            {confirmAction.customContent}
            <div className={styles.confirmActions}>
              <Button type="submit">{confirmAction.yesButton ?? 'Yes'}</Button>
              <Button simple onClick={() => setConfirmAction(null)}>
                {confirmAction.noButton ?? 'No'}
              </Button>
            </div>
          </form>
        </div>
      )}
    </Modal>
  );
}
