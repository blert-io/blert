'use client';

import { challengeName, ChallengeType } from '@blert/common';
import Link from 'next/link';
import { useCallback, useEffect, useState, useTransition } from 'react';

import { SetupCursor, SetupList, SetupState } from '@/actions/setup';
import VoteBar from '@/components/vote-bar';
import { useToast } from '@/components/toast';

import styles from './setup-list.module.scss';

type FilterableSetupListProps = {
  initialData: SetupList;
  initialFilters: {
    author?: number;
    challenge?: ChallengeType;
    sort: string;
    state?: SetupState;
    search?: string;
    scale?: number;
  };
  limit: number;
  showState?: boolean;
};

const MAX_SCALE = 8;

function scaleName(scale: number) {
  switch (scale) {
    case 1:
      return 'Solo';
    case 2:
      return 'Duo';
    case 3:
      return 'Trio';
    default:
      return `${scale}-man`;
  }
}

function formatDate(date: Date | string): string {
  return new Date(date).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function FilterableSetupList({
  initialData,
  initialFilters,
  limit,
  showState = false,
}: FilterableSetupListProps) {
  const [data, setData] = useState<SetupList>(initialData);
  const [challenge, setChallenge] = useState<string>(
    initialFilters.challenge?.toString() ?? '',
  );
  const [sort, setSort] = useState(initialFilters.sort);
  const [state, setState] = useState<SetupState | null>(
    initialFilters.state ?? null,
  );
  const [scale, setScale] = useState<string>(
    initialFilters.scale?.toString() ?? '',
  );
  const [searchInput, setSearchInput] = useState(initialFilters.search ?? '');
  const [debouncedSearch, setDebouncedSearch] = useState(
    initialFilters.search ?? '',
  );
  const [isLoading, startTransition] = useTransition();
  const [currentPage, setCurrentPage] = useState(1);
  const showToast = useToast();

  const author = initialFilters.author;

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchInput);
      setCurrentPage(1);
    }, 400);

    return () => clearTimeout(timer);
  }, [searchInput]);

  const fetchSetups = useCallback(
    async (cursor?: SetupCursor | null, resetPage: boolean = false) => {
      const params = new URLSearchParams({
        limit: limit.toString(),
        sort,
      });

      if (author !== undefined) {
        params.set('author', author.toString());
      }
      if (challenge) {
        params.set('challenge', challenge);
      }
      if (scale) {
        params.set('scale', scale);
      }
      if (state !== null) {
        params.set('state', state);
      }
      if (debouncedSearch) {
        params.set('search', debouncedSearch);
      }

      if (cursor) {
        const values: (number | string)[] = [];

        switch (sort) {
          case 'score':
            values.push(
              cursor.score,
              cursor.createdAt.getTime(),
              cursor.publicId,
            );
            break;
          case 'views':
            values.push(
              cursor.views,
              cursor.createdAt.getTime(),
              cursor.publicId,
            );
            break;
          default:
            values.push(cursor.createdAt.getTime(), cursor.publicId);
        }

        if (cursor.direction === 'forward') {
          params.set('after', values.join(','));
        } else {
          params.set('before', values.join(','));
        }
      }

      try {
        const response = await fetch(`/api/setups?${params.toString()}`);

        if (!response.ok) {
          throw new Error('Failed to fetch setups');
        }

        const newData = (await response.json()) as SetupList;
        if (newData.nextCursor !== null) {
          newData.nextCursor.createdAt = new Date(newData.nextCursor.createdAt);
        }
        if (newData.prevCursor !== null) {
          newData.prevCursor.createdAt = new Date(newData.prevCursor.createdAt);
        }
        setData(newData);

        if (resetPage) {
          setCurrentPage(1);
        }
      } catch (error) {
        console.error('Failed to fetch setups:', error);
        showToast('Failed to load setups. Please try again.', 'error');
      }
    },
    [challenge, sort, scale, debouncedSearch, state, author, limit, showToast],
  );

  useEffect(() => {
    startTransition(() => {
      void fetchSetups(null, true);
    });
  }, [challenge, sort, scale, debouncedSearch, state, author, fetchSetups]);

  const handleNextPage = useCallback(() => {
    if (data.nextCursor) {
      startTransition(() => {
        void fetchSetups(data.nextCursor);
        setCurrentPage((prev) => prev + 1);
      });
    }
  }, [data.nextCursor, fetchSetups]);

  const handlePrevPage = useCallback(() => {
    if (data.prevCursor) {
      startTransition(() => {
        void fetchSetups(data.prevCursor);
        setCurrentPage((prev) => Math.max(1, prev - 1));
      });
    }
  }, [data.prevCursor, fetchSetups]);

  const totalPages = Math.ceil(data.total / limit);
  const position = data.total - data.remaining;

  return (
    <div className={styles.setupList}>
      <div className={styles.filtersSection}>
        <div className={styles.filtersHeader}>
          <h3 className={styles.filtersTitle}>
            <i className="fas fa-filter" />
            Filters
          </h3>
          <span className={styles.resultsCount}>
            {data.total.toLocaleString()} setup{data.total !== 1 ? 's' : ''}{' '}
            found
          </span>
        </div>

        <div className={styles.filters}>
          <div className={`${styles.filter} ${styles.searchFilter}`}>
            <label>
              <i className="fas fa-search" />
              Search
            </label>
            <div className={styles.searchInputWrapper}>
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search by name or author..."
                className={styles.searchInput}
              />
              {searchInput && (
                <button
                  onClick={() => setSearchInput('')}
                  className={styles.clearSearch}
                  aria-label="Clear search"
                >
                  <i className="fas fa-times" />
                </button>
              )}
            </div>
          </div>

          {showState && (
            <div className={styles.filter}>
              <label htmlFor="state-filter">
                <i className="fas fa-flag" />
                State
              </label>
              <select
                id="state-filter"
                className={styles.filterSelect}
                value={state ?? ''}
                onChange={(e) =>
                  setState(
                    e.target.value === ''
                      ? null
                      : (e.target.value as SetupState),
                  )
                }
              >
                <option value="">All States</option>
                <option value="draft">Draft</option>
                <option value="published">Published</option>
                <option value="archived">Archived</option>
              </select>
            </div>
          )}

          <div className={`${styles.filter} ${styles.scaleFilter}`}>
            <label htmlFor="scale-filter">
              <i className="fas fa-users" />
              Scale
            </label>
            <select
              id="scale-filter"
              className={styles.filterSelect}
              value={scale}
              onChange={(e) => {
                setScale(e.target.value);
                setCurrentPage(1);
              }}
            >
              <option value="">All Scales</option>
              {Array.from({ length: MAX_SCALE }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  {scaleName(i + 1)}
                </option>
              ))}
            </select>
          </div>

          <div className={`${styles.filter} ${styles.challengeFilter}`}>
            <label htmlFor="challenge-filter">
              <i className="fas fa-shield" />
              Challenge
            </label>
            <select
              id="challenge-filter"
              className={styles.filterSelect}
              value={challenge}
              onChange={(e) => {
                setChallenge(e.target.value);
                setCurrentPage(1);
              }}
            >
              <option value="">All Challenges</option>
              <option value={ChallengeType.TOB}>Theatre of Blood</option>
              <option value={ChallengeType.COX}>Chambers of Xeric</option>
              <option value={ChallengeType.TOA}>Tombs of Amascut</option>
              <option value={ChallengeType.INFERNO}>Inferno</option>
              <option value={ChallengeType.COLOSSEUM}>Colosseum</option>
            </select>
          </div>

          <div className={`${styles.filter} ${styles.sortFilter}`}>
            <label htmlFor="sort-filter">
              <i className="fas fa-sort" />
              Sort by
            </label>
            <select
              id="sort-filter"
              className={styles.filterSelect}
              value={sort}
              onChange={(e) => {
                setSort(e.target.value);
                setCurrentPage(1);
              }}
            >
              <option value="latest">Latest</option>
              <option value="score">Score</option>
              <option value="views">Views</option>
            </select>
          </div>
        </div>
      </div>

      <div className={styles.resultsContainer}>
        {isLoading && (
          <div className={styles.loadingOverlay}>
            <div className={styles.loadingSpinner}>
              <i className="fas fa-spinner fa-spin" />
              <span>Loading setups...</span>
            </div>
          </div>
        )}

        <div
          className={`${styles.setupsList} ${isLoading ? styles.loading : ''}`}
        >
          {data.setups.length > 0 ? (
            data.setups.map((setup) => (
              <Link
                key={setup.publicId}
                href={`/setups/${setup.publicId}${setup.state === 'draft' ? '/edit' : ''}`}
                className={styles.setupCard}
              >
                <div className={styles.setupHeader}>
                  <div className={styles.setupTitle}>
                    <h3>{setup.name}</h3>
                    <div className={styles.setupMeta}>
                      <span className={styles.author}>
                        <i className="fas fa-user" />
                        {setup.author}
                      </span>
                      <span className={styles.meta}>
                        <i className="fas fa-shield" />
                        {challengeName(setup.challengeType)}
                      </span>
                      <span className={styles.meta}>
                        <i className="fas fa-users" />
                        {scaleName(setup.scale)}
                      </span>
                      {showState && (
                        <span
                          className={`${styles.meta} ${styles.state} ${styles[setup.state]}`}
                        >
                          <i
                            className={`fas ${
                              setup.state === 'draft'
                                ? 'fa-edit'
                                : setup.state === 'published'
                                  ? 'fa-check-circle'
                                  : 'fa-archive'
                            }`}
                          />
                          {setup.state}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className={styles.setupStats}>
                    <VoteBar
                      likes={setup.likes}
                      dislikes={setup.dislikes}
                      currentVote={null}
                      disabled
                      width={200}
                    />
                    <div className={styles.views}>
                      <i className="fas fa-eye" />
                      <span>{setup.views.toLocaleString()}</span>
                    </div>
                  </div>
                </div>

                <div className={styles.setupFooter}>
                  <div className={styles.dates}>
                    <span className={styles.date}>
                      <i className="fas fa-calendar-plus" />
                      Created {formatDate(setup.createdAt)}
                    </span>
                    {setup.updatedAt && (
                      <span className={styles.date}>
                        <i className="fas fa-calendar-edit" />
                        Updated {formatDate(setup.updatedAt)}
                      </span>
                    )}
                  </div>
                </div>
              </Link>
            ))
          ) : (
            <div className={styles.emptyState}>
              <i className="fas fa-search" />
              <h3>No setups found</h3>
              <p>
                Try adjusting your filters or search terms to find more setups.
              </p>
            </div>
          )}
        </div>
      </div>

      {totalPages > 1 && (
        <div className={styles.pagination}>
          <button
            disabled={!data.prevCursor || isLoading}
            onClick={handlePrevPage}
            className={styles.paginationButton}
          >
            <i className="fas fa-chevron-left" />
            <span>Previous</span>
          </button>

          <div className={styles.paginationInfo}>
            <span className={styles.pageIndicator}>
              Page {currentPage} of {totalPages}
            </span>
            <span className={styles.resultsInfo}>
              Showing {Math.min(position + 1, data.total)}-
              {Math.min(position + limit, data.total)} of{' '}
              {data.total.toLocaleString()}
            </span>
          </div>

          <button
            disabled={!data.nextCursor || isLoading}
            onClick={handleNextPage}
            className={styles.paginationButton}
          >
            <span>Next</span>
            <i className="fas fa-chevron-right" />
          </button>
        </div>
      )}
    </div>
  );
}
