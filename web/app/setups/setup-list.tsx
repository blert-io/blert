'use client';

import { challengeName, ChallengeType } from '@blert/common';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useContext } from 'react';

import {
  SetupListItem,
  SetupCursor,
  SetupSort,
  SetupState,
} from '@/actions/setup';
import RadioInput from '@/components/radio-input';
import VoteBar from '@/components/vote-bar';
import { DisplayContext } from '@/display';

import styles from './setup-list.module.scss';

function formatDate(date: Date | string): string {
  return new Date(date).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

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

type SetupListProps = {
  setups: SetupListItem[];
  nextCursor?: SetupCursor | null;
  prevCursor?: SetupCursor | null;
  currentFilter?: {
    challenge?: ChallengeType;
    orderBy: SetupSort;
    search?: string;
    state?: SetupState;
    scale?: number;
  };
  showState?: boolean;
  showStateFilter?: boolean;
  showSearch?: boolean;
  showPagination?: boolean;
  className?: string;
  position: number;
  total: number;
  limit: number;
};

export function SetupList({
  setups,
  nextCursor,
  prevCursor,
  currentFilter,
  showState,
  showStateFilter = false,
  showSearch = false,
  showPagination = false,
  className,
  position,
  total,
  limit,
}: SetupListProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const display = useContext(DisplayContext);

  const currentPage = total > 0 ? Math.floor(position / limit) + 1 : 0;
  const totalPages = Math.ceil(total / limit);

  const handleFilterChange = useCallback(
    (name: string, value: string | number | null) => {
      const params = new URLSearchParams(searchParams);
      if (value === null) {
        params.delete(name);
      } else {
        params.set(name, value.toString());
      }
      params.delete('after');
      params.delete('before');
      router.push(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams],
  );

  const handleCursorNavigation = useCallback(
    (cursor: SetupCursor | null) => {
      if (cursor === null) {
        return;
      }

      const params = new URLSearchParams(searchParams);
      const sort = params.get('sort') ?? 'latest';
      let values: Array<number | string>;

      switch (sort) {
        case 'latest':
          values = [cursor.createdAt.getTime(), cursor.publicId];
          break;
        case 'score':
          values = [cursor.score, cursor.createdAt.getTime(), cursor.publicId];
          break;
        case 'views':
          values = [cursor.views, cursor.createdAt.getTime(), cursor.publicId];
          break;
        default:
          values = [cursor.createdAt.getTime(), cursor.publicId];
          break;
      }

      if (cursor.direction === 'forward') {
        params.delete('before');
        params.set('after', values.join(','));
      } else {
        params.delete('after');
        params.set('before', values.join(','));
      }

      router.push(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams],
  );

  const handlePageChange = useCallback(
    (page: number) => {
      if (page === currentPage) {
        return;
      }

      if (page === currentPage + 1 && nextCursor) {
        handleCursorNavigation(nextCursor);
        return;
      }

      if (page === currentPage - 1 && prevCursor) {
        handleCursorNavigation(prevCursor);
        return;
      }

      const params = new URLSearchParams(searchParams);
      params.delete('after');
      params.delete('before');
      router.push(`/setups?${params.toString()}`);
    },
    [
      currentPage,
      nextCursor,
      prevCursor,
      handleCursorNavigation,
      router,
      searchParams,
    ],
  );

  return (
    <div className={`${styles.setupList} ${className || ''}`}>
      {currentFilter && (
        <div className={styles.filtersSection}>
          <div className={styles.filtersHeader}>
            <h3 className={styles.filtersTitle}>
              <i className="fas fa-filter" />
              Filters
            </h3>
            <span className={styles.resultsCount}>
              {total.toLocaleString()} setup{total !== 1 ? 's' : ''} found
            </span>
          </div>

          <div className={styles.filters}>
            {showSearch && (
              <div className={`${styles.filter} ${styles.searchFilter}`}>
                <label>
                  <i className="fas fa-search" />
                  Search
                </label>
                <input
                  type="text"
                  value={currentFilter.search ?? ''}
                  onChange={(e) =>
                    handleFilterChange('search', e.target.value || null)
                  }
                  placeholder="Search setups by name or author..."
                  className={styles.searchInput}
                />
              </div>
            )}

            {showStateFilter && (
              <div className={styles.filter}>
                <label htmlFor="state-filter">
                  <i className="fas fa-flag" />
                  State
                </label>
                <select
                  id="state-filter"
                  className={styles.filterSelect}
                  value={currentFilter.state || ''}
                  onChange={(e) =>
                    handleFilterChange(
                      'state',
                      e.target.value === '' ? null : e.target.value,
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
                value={currentFilter.scale || ''}
                onChange={(e) =>
                  handleFilterChange(
                    'scale',
                    e.target.value === '' ? null : parseInt(e.target.value),
                  )
                }
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
                value={currentFilter.challenge || ''}
                onChange={(e) =>
                  handleFilterChange(
                    'challenge',
                    e.target.value === '' ? null : parseInt(e.target.value),
                  )
                }
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
                value={currentFilter.orderBy}
                onChange={(e) => handleFilterChange('sort', e.target.value)}
              >
                <option value="latest">Latest</option>
                <option value="score">Score</option>
                <option value="views">Views</option>
              </select>
            </div>
          </div>
        </div>
      )}

      <div className={styles.setupsList}>
        {setups.length > 0 ? (
          setups.map((setup) => (
            <Link
              key={setup.publicId}
              href={`/setups/${setup.publicId}${
                setup.state === 'draft' ? '/edit' : ''
              }`}
              className={styles.setupCard}
            >
              <div className={styles.setupHeader}>
                <div className={styles.setupTitle}>
                  <h3>{setup.name}</h3>
                  <div className={styles.setupMeta}>
                    {!showState && (
                      <span className={styles.author}>
                        <i className="fas fa-user" />
                        {setup.author}
                      </span>
                    )}
                    <span className={styles.challenge}>
                      <i className="fas fa-shield" />
                      {challengeName(setup.challengeType)}
                    </span>
                    {showState && (
                      <span
                        className={`${styles.state} ${styles[setup.state]}`}
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

      {showPagination && totalPages > 1 && (
        <div className={styles.pagination}>
          <button
            disabled={currentPage <= 1}
            onClick={() => handlePageChange(currentPage - 1)}
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
              Showing {Math.min(position + 1, total)}-
              {Math.min(position + limit, total)} of {total.toLocaleString()}
            </span>
          </div>

          <button
            disabled={!nextCursor || currentPage === totalPages}
            onClick={() => handlePageChange(currentPage + 1)}
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
