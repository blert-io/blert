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
    <div className={`${styles.list} ${className || ''}`}>
      {currentFilter && (
        <div className={styles.filters}>
          {showSearch && (
            <div className={`${styles.filter} ${styles.search}`}>
              <label>Search</label>
              <input
                type="text"
                value={currentFilter.search ?? ''}
                onChange={(e) =>
                  handleFilterChange('search', e.target.value || null)
                }
                placeholder="Search setups…"
              />
            </div>
          )}
          {showStateFilter && (
            <div className={`${styles.filter} ${styles.state}`}>
              <label>State</label>
              <RadioInput.Group
                name="state-filter"
                onChange={(value) =>
                  handleFilterChange(
                    'state',
                    value === 'all' ? null : value.toString(),
                  )
                }
              >
                <RadioInput.Option
                  checked={currentFilter.state === undefined}
                  id="state-filter-all"
                  label="All"
                  value="all"
                />
                <RadioInput.Option
                  checked={currentFilter.state === 'draft'}
                  id="state-filter-draft"
                  label="Draft"
                  value="draft"
                />
                <RadioInput.Option
                  checked={currentFilter.state === 'published'}
                  id="state-filter-published"
                  label="Published"
                  value="published"
                />
                <RadioInput.Option
                  checked={currentFilter.state === 'archived'}
                  id="state-filter-archived"
                  label="Archived"
                  value="archived"
                />
              </RadioInput.Group>
            </div>
          )}
          <div className={`${styles.filter} ${styles.scale}`}>
            <label>Scale</label>
            <RadioInput.Group
              name="scale-filter"
              onChange={(value) =>
                handleFilterChange('scale', value === 'all' ? null : value)
              }
            >
              <RadioInput.Option
                checked={currentFilter.scale === undefined}
                id="scale-filter-all"
                label="All"
                value="all"
              />
              {Array.from({ length: MAX_SCALE }, (_, i) => (
                <RadioInput.Option
                  checked={currentFilter.scale === i + 1}
                  key={i}
                  id={`scale-filter-${i + 1}`}
                  label={
                    display.isCompact() ? (i + 1).toString() : scaleName(i + 1)
                  }
                  value={i + 1}
                />
              ))}
            </RadioInput.Group>
          </div>
          <div className={`${styles.filter} ${styles.challenge}`}>
            <label>Challenge</label>
            <RadioInput.Group
              name="challenge-filter"
              onChange={(value) =>
                handleFilterChange(
                  'challenge',
                  value === 'all' ? null : value.toString(),
                )
              }
            >
              <RadioInput.Option
                checked={currentFilter.challenge === undefined}
                id="challenge-filter-all"
                label="All"
                value="all"
              />
              <RadioInput.Option
                checked={currentFilter.challenge === ChallengeType.TOB}
                id="challenge-filter-tob"
                label="ToB"
                value={ChallengeType.TOB.toString()}
              />
              <RadioInput.Option
                checked={currentFilter.challenge === ChallengeType.COX}
                id="challenge-filter-cox"
                label="CoX"
                value={ChallengeType.COX.toString()}
              />
              <RadioInput.Option
                checked={currentFilter.challenge === ChallengeType.TOA}
                id="challenge-filter-toa"
                label="ToA"
                value={ChallengeType.TOA.toString()}
              />
              <RadioInput.Option
                checked={currentFilter.challenge === ChallengeType.INFERNO}
                id="challenge-filter-inferno"
                label="Inferno"
                value={ChallengeType.INFERNO.toString()}
              />
              <RadioInput.Option
                checked={currentFilter.challenge === ChallengeType.COLOSSEUM}
                id="challenge-filter-colosseum"
                label="Colo"
                value={ChallengeType.COLOSSEUM.toString()}
              />
            </RadioInput.Group>
          </div>
          <div className={styles.filter}>
            <label>Sort by</label>
            <RadioInput.Group
              name="sort-filter"
              onChange={(value) => handleFilterChange('sort', value.toString())}
            >
              <RadioInput.Option
                checked={currentFilter.orderBy === 'latest'}
                id="sort-filter-latest"
                label="Latest"
                value="latest"
              />
              <RadioInput.Option
                checked={currentFilter.orderBy === 'score'}
                id="sort-filter-score"
                label="Score"
                value="score"
              />
              <RadioInput.Option
                checked={currentFilter.orderBy === 'views'}
                id="sort-filter-views"
                label="Views"
                value="views"
              />
            </RadioInput.Group>
          </div>
        </div>
      )}
      <div className={styles.list}>
        {setups.length > 0 ? (
          setups.map((setup) => (
            <Link
              key={setup.publicId}
              href={`/setups/${setup.publicId}${
                setup.state === 'draft' ? '/edit' : ''
              }`}
              className={styles.setup}
            >
              <div className={styles.header}>
                <div className={styles.title}>
                  <h3>{setup.name}</h3>
                  <div className={styles.meta}>
                    <span className={styles.author}>by {setup.author}</span>
                    <span className={styles.challenge}>
                      {challengeName(setup.challengeType)}
                    </span>
                    {showState && (
                      <span
                        className={`${styles.state} ${styles[setup.state]}`}
                      >
                        {setup.state}
                      </span>
                    )}
                  </div>
                </div>
                <div className={styles.stats}>
                  <VoteBar
                    likes={setup.likes}
                    dislikes={setup.dislikes}
                    currentVote={null}
                    disabled
                    width={200}
                  />
                  <div className={styles.views}>
                    <i className="fas fa-eye" />
                    <span>{setup.views}</span>
                  </div>
                </div>
              </div>
              <div className={styles.dates}>
                <div className={styles.date}>
                  Created {formatDate(setup.createdAt)}
                </div>
                {setup.updatedAt && (
                  <div className={styles.date}>
                    Updated {formatDate(setup.updatedAt)}
                  </div>
                )}
              </div>
            </Link>
          ))
        ) : (
          <p className={styles.noSetups}>No setups found</p>
        )}
      </div>
      {showPagination && (
        <div className={styles.pagination}>
          <button
            disabled={currentPage <= 1}
            onClick={() => handlePageChange(currentPage - 1)}
          >
            <i className="fas fa-chevron-left" />
            <span className="sr-only">Previous page</span>
          </button>
          <span>
            Page {currentPage} of {totalPages}
          </span>
          <button
            disabled={!nextCursor || currentPage === totalPages}
            onClick={() => handlePageChange(currentPage + 1)}
          >
            <i className="fas fa-chevron-right" />
            <span className="sr-only">Next page</span>
          </button>
        </div>
      )}
    </div>
  );
}
