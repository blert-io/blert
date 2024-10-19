'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Dispatch, SetStateAction, useEffect, useRef, useState } from 'react';

import { ChallengeOverview, SortableFields } from '@/actions/challenge';
import {
  modeNameAndColor,
  statusNameAndColor,
} from '@/components/raid-quick-details';
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
}

type ColumnRenderer = (challenge: ChallengeOverview) => React.ReactNode;

type ColumnInfo = {
  name: string;
  fullName?: string;
  renderer: ColumnRenderer;
  align?: 'left' | 'right' | 'center';
  width?: number;
  sortKey?: SortableFields;
};

type PickType<T, U> = Pick<
  T,
  {
    [K in keyof T]: T[K] extends U ? K : never;
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
    width: 80,
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
  },
  [Column.OVERALL_TIME]: {
    name: 'Overall',
    fullName: 'Overall Time',
    align: 'right',
    renderer: ticksRenderer('overallTicks'),
  },
  [Column.TOTAL_DEATHS]: {
    name: 'Deaths',
    align: 'right',
    renderer: valueRenderer('totalDeaths'),
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

const DEFAULT_SELECTED_COLUMNS = [
  Column.UUID,
  Column.DATE,
  Column.TYPE,
  Column.STATUS,
  Column.SCALE,
  Column.PARTY,
  Column.CHALLENGE_TIME,
  Column.TOTAL_DEATHS,
];

type TableProps = {
  challenges: ChallengeOverview[];
  context: SearchContext;
  setContext: Dispatch<SetStateAction<SearchContext>>;
  loading: boolean;
};

export default function Table(props: TableProps) {
  const router = useRouter();

  const tableRef = useRef<HTMLTableElement>(null);
  const headingRef = useRef<HTMLTableSectionElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);

  const [selectedChallenges, setSelectedChallenges] = useState<number[]>([]);
  const [lastClickedChallenge, setLastClickedChallenge] = useState<
    [number, number] | null
  >(null);

  useEffect(() => {
    const clickListener = () => setContextMenu(null);
    const menuListener = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) {
        e.preventDefault();
        return;
      }

      if (tableRef.current?.contains(e.target as Node)) {
        e.preventDefault();

        const menu: ContextMenu = {
          y: e.clientY,
          x:
            e.clientX + MENU_WIDTH >
            tableRef.current.getBoundingClientRect().right
              ? e.clientX - MENU_WIDTH + 5
              : e.clientX,
        };

        let target: HTMLElement | null = e.target as HTMLElement;
        if (target.tagName !== 'TD' && target.tagName !== 'TH') {
          target = target.closest('td');
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
    window.addEventListener('click', clickListener);
    return () => {
      window.removeEventListener('click', clickListener);
      window.removeEventListener('contextmenu', menuListener);
    };
  });

  const [selectedColumns, setSelectedColumns] = useState<Column[]>(
    DEFAULT_SELECTED_COLUMNS,
  );

  useEffect(() => setSelectedChallenges([]), [props.challenges]);

  return (
    <>
      <div className={styles.wrapper}>
        <table className={styles.table} ref={tableRef}>
          <thead ref={headingRef}>
            <tr>
              {selectedColumns.map((c) => {
                const column = COLUMNS[c];
                let suffix = undefined;

                if (props.context.sort && column.sortKey) {
                  const mainSort = props.context.sort[0];
                  if (mainSort.slice(1) === column.sortKey) {
                    suffix = (
                      <i
                        className={`fas fa-sort-${mainSort[0] === '+' ? 'up' : 'down'}`}
                      />
                    );
                  } else {
                    suffix = <i className="fas fa-sort" />;
                  }
                }

                return (
                  <th
                    key={c}
                    data-context={`heading:${c}`}
                    style={{ width: column.width }}
                  >
                    {column.name}
                    {suffix}
                  </th>
                );
              })}
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
                {selectedColumns.map((column) => {
                  const align = COLUMNS[column].align ?? 'left';
                  return (
                    <td
                      key={column}
                      data-context={`row:${i}:${column}`}
                      style={{ textAlign: align, width: COLUMNS[column].width }}
                    >
                      {COLUMNS[column].renderer(challenge)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {contextMenu && (
        <ContextMenu
          context={contextMenu}
          challenges={props.challenges}
          menuRef={menuRef}
          setColumns={setSelectedColumns}
          setContext={props.setContext}
          loading={props.loading}
        />
      )}
    </>
  );
}

const DOUBLE_CLICK_THRESHOLD = 300;
const MENU_WIDTH = 300;

function ContextMenu({
  challenges,
  context,
  menuRef,
  setColumns,
  setContext,
  loading,
}: {
  challenges: ChallengeOverview[];
  context: ContextMenu;
  menuRef: React.RefObject<HTMLDivElement>;
  setColumns: Dispatch<SetStateAction<Column[]>>;
  setContext: Dispatch<SetStateAction<SearchContext>>;
  loading: boolean;
}) {
  const entries: React.ReactNode[] = [];

  let dividerCount = 0;
  const divider = () => (
    <div className={styles.divider} key={`divider-${dividerCount++}`} />
  );

  if (context.multipleChallenges) {
    const allChallenges = context.multipleChallenges.map((i) => challenges[i]);

    entries.push(
      <div className={`${styles.entry} ${styles.inactive}`} key="selected">
        {context.multipleChallenges.length} challenges selected
      </div>,
    );
    entries.push(divider());

    entries.push(
      <button
        className={styles.entry}
        key="copy-id"
        onClick={() =>
          navigator.clipboard.writeText(
            allChallenges.map((c) => c.uuid).join('\n'),
          )
        }
      >
        Copy IDs
      </button>,
    );
  }

  if (context.heading !== undefined) {
    const column = COLUMNS[context.heading.column];

    if (column.name !== '') {
      if (column.sortKey) {
        entries.push(
          <button
            className={styles.entry}
            disabled={loading}
            key="sort-column-asc"
            onClick={() =>
              setContext((context) => ({
                ...context,
                sort: [`+${column.sortKey!}`],
              }))
            }
          >
            Sort by {column.fullName ?? column.name}{' '}
            <i className="fas fa-arrow-up-wide-short" />
          </button>,
        );
        entries.push(
          <button
            className={styles.entry}
            disabled={loading}
            key="sort-column-desc"
            onClick={() =>
              setContext((context) => ({
                ...context,
                sort: [`-${column.sortKey!}`],
              }))
            }
          >
            Sort by {column.fullName ?? column.name}{' '}
            <i className="fas fa-arrow-down-wide-short" />
          </button>,
        );
      }

      if (entries.length > 0) {
        entries.push(divider());
      }

      entries.push(
        <button
          className={styles.entry}
          disabled={loading}
          key="remove-column"
          onClick={() =>
            setColumns((columns) =>
              columns.filter((c) => c !== context.heading!.column),
            )
          }
        >
          Remove column {column.name}
        </button>,
      );
    }

    entries.push(
      <div className={styles.entry} key="manage-columns">
        Manage columns…
      </div>,
    );

    entries.push(
      <button
        className={styles.entry}
        key="reset-columns"
        onClick={() => setColumns(DEFAULT_SELECTED_COLUMNS)}
      >
        Reset columns
      </button>,
    );
  }

  if (context.challenge) {
    const challenge = challenges[context.challenge.index];

    if (context.challenge.column === Column.PARTY) {
      entries.push(
        <div
          className={`${styles.entry} ${styles.inactive} ${styles.info}`}
          key="party-list"
        >
          {challenge.party.map((p) => p.username).join(', ')}
        </div>,
      );
      entries.push(divider());
    }

    entries.push(
      <div className={styles.entry} key="challenge">
        <Link href={challengeUrl(challenge.type, challenge.uuid)}>
          View challenge
        </Link>
      </div>,
    );

    entries.push(
      <button
        className={styles.entry}
        key="similar"
        onClick={() =>
          setContext((prev) => ({
            ...prev,
            filters: {
              ...prev.filters,
              party: challenge.party.map((p) => p.currentUsername),
              scale: [challenge.party.length],
              type: [challenge.type],
            },
          }))
        }
      >
        Find similar challenges
      </button>,
    );

    entries.push(
      <button
        className={styles.entry}
        key="copy-url"
        onClick={() =>
          navigator.clipboard.writeText(
            window.location.origin +
              challengeUrl(challenge.type, challenge.uuid),
          )
        }
      >
        Copy URL
      </button>,
    );
    entries.push(
      <button
        className={styles.entry}
        key="copy-id"
        onClick={() => navigator.clipboard.writeText(challenge.uuid)}
      >
        Copy ID
      </button>,
    );
  }

  return (
    <div
      className={styles.contextMenu}
      ref={menuRef}
      style={{
        top: context.y,
        left: context.x,
        width: MENU_WIDTH,
      }}
    >
      {entries}
    </div>
  );
}
