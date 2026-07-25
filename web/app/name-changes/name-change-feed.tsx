'use client';

import Link from 'next/link';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';

import { getNameChanges } from '@/actions/change-name';
import { ButtonLink } from '@/components/button';
import { useDebounced } from '@/hooks/debounce';

import { FeedRow, PAGE_SIZE, toFeedRow } from './format';
import NameChangeItem from './name-change-row';

import styles from './style.module.scss';

const SEARCH_DEBOUNCE_MS = 300;

type RowGroup = { key: string; label: string; rows: FeedRow[] };

/** Collapses consecutive rows sharing a time bucket into labeled groups. */
function groupRows(rows: FeedRow[]): RowGroup[] {
  const groups: RowGroup[] = [];
  for (const row of rows) {
    const last = groups.at(-1);
    if (last?.key === row.group.key) {
      last.rows.push(row);
    } else {
      groups.push({ key: row.group.key, label: row.group.label, rows: [row] });
    }
  }
  return groups;
}

type NameChangeFeedProps = {
  initialRows: FeedRow[];
  initialCursor: string | null;
  trackedTotal: number;
  /** Fixed reference time used to format client-fetched rows consistently. */
  serverNow: number;
};

export default function NameChangeFeed({
  initialRows,
  initialCursor,
  trackedTotal,
  serverNow,
}: NameChangeFeedProps) {
  const [rows, setRows] = useState(initialRows);
  const [cursor, setCursor] = useState(initialCursor);
  const [total, setTotal] = useState(trackedTotal);
  const [query, setQuery] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const requestId = useRef(0);
  const mounted = useRef(false);

  const debouncedQuery = useDebounced(query.trim(), SEARCH_DEBOUNCE_MS);

  const runSearch = useCallback(
    async (q: string) => {
      const id = ++requestId.current;
      setSearching(true);
      try {
        const page = await getNameChanges(null, PAGE_SIZE, q);
        if (id !== requestId.current) {
          return;
        }
        setRows(page.changes.map((c) => toFeedRow(c, serverNow)));
        setCursor(page.nextCursor);
        setTotal(page.total);
        setActiveQuery(q);
      } finally {
        if (id === requestId.current) {
          setSearching(false);
        }
      }
    },
    [serverNow],
  );

  useEffect(() => {
    // The initial page is server-rendered, so skip the first run.
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    void runSearch(debouncedQuery);
  }, [debouncedQuery, runSearch]);

  const showMore = useCallback(async () => {
    if (cursor === null) {
      return;
    }
    const id = requestId.current;
    setLoadingMore(true);
    try {
      const page = await getNameChanges(cursor, PAGE_SIZE, activeQuery);
      if (id !== requestId.current) {
        return;
      }
      setRows((prev) => [
        ...prev,
        ...page.changes.map((c) => toFeedRow(c, serverNow)),
      ]);
      setCursor(page.nextCursor);
    } finally {
      // Unconditionally clear the loading state as calls cannot overlap.
      setLoadingMore(false);
    }
  }, [cursor, activeQuery, serverNow]);

  const searchActive = activeQuery !== '';
  const progress = total > 0 ? Math.min(100, (rows.length / total) * 100) : 100;

  return (
    <div className={styles.feed}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <i className={`fas fa-history ${styles.headerIcon}`} />
          <h1 className={styles.headerTitle}>Name Changes</h1>
          {!searchActive && (
            <span className={styles.trackedCount}>
              {trackedTotal.toLocaleString()} tracked
            </span>
          )}
        </div>
        <div className={styles.headerRight}>
          <div
            className={styles.search}
            data-active={query !== '' ? 'true' : undefined}
          >
            <i className="fas fa-magnifying-glass" />
            <input
              type="text"
              className={styles.searchInput}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a name…"
              aria-label="Search name changes"
              maxLength={24}
              spellCheck={false}
              autoComplete="off"
            />
            {query !== '' && (
              <button
                type="button"
                className={styles.searchClear}
                onClick={() => setQuery('')}
                aria-label="Clear search"
              >
                <i className="fas fa-circle-xmark" />
              </button>
            )}
          </div>
          <ButtonLink href="/change-name" className={styles.submit}>
            <i className="fas fa-plus" /> Submit
          </ButtonLink>
        </div>
      </div>

      {searching && <div className={styles.loadingBar} />}

      {searchActive ? (
        <SearchResults
          rows={rows}
          query={activeQuery}
          total={total}
          hasMore={cursor !== null}
          loadingMore={loadingMore}
          trackedTotal={trackedTotal}
          onShowMore={() => void showMore()}
        />
      ) : (
        <DefaultFeed
          rows={rows}
          total={total}
          progress={progress}
          hasMore={cursor !== null}
          loadingMore={loadingMore}
          onShowMore={() => void showMore()}
        />
      )}
    </div>
  );
}

function DefaultFeed({
  rows,
  total,
  progress,
  hasMore,
  loadingMore,
  onShowMore,
}: {
  rows: FeedRow[];
  total: number;
  progress: number;
  hasMore: boolean;
  loadingMore: boolean;
  onShowMore: () => void;
}) {
  if (rows.length === 0) {
    return (
      <div className={styles.empty}>
        <i className="fas fa-inbox" />
        <span className={styles.emptyTitle}>No name changes tracked yet</span>
      </div>
    );
  }

  return (
    <>
      <div className={styles.list}>
        {groupRows(rows).map((group) => (
          <Fragment key={group.key}>
            <div className={styles.groupHeader}>{group.label}</div>
            <div className={styles.groupBody}>
              {group.rows.map((row) => (
                <NameChangeItem key={row.id} row={row} />
              ))}
            </div>
          </Fragment>
        ))}
      </div>
      <div className={styles.footer}>
        <span className={styles.footerCount}>
          Showing {rows.length.toLocaleString()} of {total.toLocaleString()}
        </span>
        <div className={styles.progressTrack}>
          <div
            className={styles.progressFill}
            style={{ width: `${progress}%` }}
          />
        </div>
        {hasMore && (
          <ShowMoreButton loading={loadingMore} onClick={onShowMore} />
        )}
      </div>
    </>
  );
}

function SearchResults({
  rows,
  query,
  total,
  hasMore,
  loadingMore,
  trackedTotal,
  onShowMore,
}: {
  rows: FeedRow[];
  query: string;
  total: number;
  hasMore: boolean;
  loadingMore: boolean;
  trackedTotal: number;
  onShowMore: () => void;
}) {
  if (rows.length === 0) {
    return (
      <div className={styles.empty}>
        <i className="fas fa-user-slash" />
        <span className={styles.emptyTitle}>
          No name changes match &ldquo;{query}&rdquo;
        </span>
        <span className={styles.emptyHint}>
          Changed your name and it&apos;s missing here?{' '}
          <Link href="/change-name">Submit it</Link>
        </span>
      </div>
    );
  }

  return (
    <>
      <div className={styles.list}>
        <div className={styles.groupHeader}>
          {total.toLocaleString()} {total === 1 ? 'match' : 'matches'} for
          &ldquo;{query}&rdquo;
        </div>
        <div className={styles.groupBody}>
          {rows.map((row) => (
            <NameChangeItem key={row.id} row={row} highlight={query} />
          ))}
        </div>
      </div>
      <div className={styles.searchFooter}>
        {hasMore ? (
          <ShowMoreButton loading={loadingMore} onClick={onShowMore} />
        ) : (
          <span>
            Searching all {trackedTotal.toLocaleString()} tracked changes
          </span>
        )}
      </div>
    </>
  );
}

function ShowMoreButton({
  loading,
  onClick,
}: {
  loading: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={styles.showMore}
      onClick={onClick}
      disabled={loading}
    >
      {loading ? (
        <>
          <i className="fas fa-spinner fa-spin" /> Loading
        </>
      ) : (
        <>
          Show {PAGE_SIZE} more <i className="fas fa-chevron-down" />
        </>
      )}
    </button>
  );
}
