'use client';

import { SplitType } from '@blert/common';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import {
  BasicSortableFields,
  ChallengeOverview,
  SortableFields,
} from '@/actions/challenge';
import { getLocalSetting } from '@/utils/user-settings';
import { UrlParams, queryString } from '@/utils/url';

import {
  SearchContext,
  contextFromUrlParams,
  countActiveFilters,
  extraFieldsToUrlParam,
  filtersToUrlParams,
  isDefaultSearchFilters,
} from './context';
import Filters, { resetChallengeFilters } from './filters';
import FilterPanel from '../filter-panel';
import { useFilterPanel } from '../filter-panel-context';
import Table, {
  extraFieldsForColumns,
  DEFAULT_SELECTED_COLUMNS,
} from './table';
import { SelectedColumn } from './types';

import styles from './style.module.scss';

type FilteredStats = {
  count: number;
};

type SearchProps = {
  initialContext: SearchContext;
  initialChallenges: ChallengeOverview[];
  initialStats: FilteredStats;
};

class LoadChallengeError extends Error {
  public readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'LoadChallengeError';
    this.status = status;
  }
}

type LoadErrorState = {
  message: string;
  details?: string;
};

enum FetchAction {
  LOAD,
  FORWARD,
  BACK,
}

function getSortKeyValue(challenge: ChallengeOverview, key: SortableFields) {
  if (key.startsWith('splits:')) {
    const split = Number.parseInt(key.slice(7)) as SplitType;
    return challenge.splits?.[split]?.ticks ?? null;
  }

  if (key.startsWith('tob:')) {
    const field = key.slice(4) as keyof NonNullable<
      ChallengeOverview['tobStats']
    >;
    return (challenge.tobStats?.[field] as number | null | undefined) ?? null;
  }

  const k = key as BasicSortableFields;
  return challenge[k] ?? null;
}

function challengesQueryParams(
  context: SearchContext,
  challenges: ChallengeOverview[],
  action: FetchAction,
): [UrlParams, UrlParams] {
  const baseParams = filtersToUrlParams(context.filters);

  const params: UrlParams = { ...baseParams };
  const sortParam = [];

  let hasTime = false;

  const sortValues: (number | string)[] = [];

  let keyChallenge: ChallengeOverview | null = null;
  if (action === FetchAction.FORWARD && challenges.length > 0) {
    keyChallenge = challenges[challenges.length - 1];
  } else if (action === FetchAction.BACK && challenges.length > 0) {
    keyChallenge = challenges[0];
  }

  // Default sort by startTime descending.
  const sorts = context.sort ?? ['-startTime'];
  for (const sort of sorts) {
    const sortField = sort.slice(1).split('#')[0] as SortableFields;
    if (sortField === 'startTime') {
      hasTime = true;
    }

    if (keyChallenge !== null) {
      const keyField = getSortKeyValue(keyChallenge, sortField);
      if (keyField !== null) {
        const keyValue =
          keyField instanceof Date
            ? keyField.getTime()
            : (keyField as string | number);
        sortValues.push(keyValue);
      } else {
        sortValues.push('null');
      }
    }

    sortParam.push(sort);
  }

  if (!hasTime) {
    sortParam.push('-startTime');
    if (keyChallenge !== null) {
      sortValues.push(keyChallenge.startTime.getTime());
    }
  }

  // When sorting by a split column with accurate splits enabled, only include
  // challenges which have that split set.
  if (context.filters.accurateSplits) {
    for (const sort of sorts) {
      const sortField = sort.slice(1).split('#')[0];
      if (sortField.startsWith('splits:')) {
        const splitType = sortField.slice(7);
        if (baseParams[`split:${splitType}`] === undefined) {
          baseParams[`split:${splitType}`] = 'ge0';
        }
      }
    }
  }

  if (action === FetchAction.LOAD) {
    params.after = context.pagination.after;
    params.before = context.pagination.before;
  } else if (action === FetchAction.BACK) {
    params.before = sortValues;
  } else if (action === FetchAction.FORWARD) {
    params.after = sortValues;
  }

  params.sort = sortParam;
  return [baseParams, params];
}

export default function Search({
  initialContext,
  initialChallenges,
  initialStats,
}: SearchProps) {
  const [initialFetch, setInitialFetch] = useState(true);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<LoadErrorState | null>(null);

  const [context, setContext] = useState(initialContext);
  const [challenges, setChallenges] =
    useState<ChallengeOverview[]>(initialChallenges);
  const [stats, setStats] = useState<FilteredStats>(initialStats);
  const lastLoadedQuery = useRef<string | null>(null);

  const { setActiveCount } = useFilterPanel();
  useEffect(() => {
    setActiveCount(countActiveFilters(context.filters));
  }, [context.filters, setActiveCount]);

  const resultsPerPage = 25; // TODO(frolv): Make this configurable.

  const [hasMore, setHasMore] = useState(
    initialChallenges.length >= resultsPerPage,
  );
  const [hasPrevious, setHasPrevious] = useState(false);

  const errorForStatus = (status?: number): LoadErrorState => {
    if (status === 429) {
      return {
        message: 'Search temporarily rate limited',
        details:
          'Too many requests hit the server. Please wait a few seconds and try again.',
      };
    }

    return {
      message: 'Unable to load challenges right now.',
      details: 'Please refresh the page or adjust your filters and retry.',
    };
  };

  const loadChallenges = async (
    action: FetchAction = FetchAction.LOAD,
    ctx: SearchContext = context,
  ) => {
    const [baseParams, paginationParams] = challengesQueryParams(
      ctx,
      challenges,
      action,
    );

    const updatedUrl = `/search/challenges?${queryString(paginationParams)}`;
    window.history.replaceState(null, '', updatedUrl);

    paginationParams.limit = resultsPerPage + 1;
    paginationParams.extraFields = extraFieldsToUrlParam(ctx.extraFields);

    const queryKey = queryString(paginationParams);
    if (queryKey === lastLoadedQuery.current) {
      return;
    }
    lastLoadedQuery.current = queryKey;

    setLoading(true);
    setLoadError(null);

    try {
      const challengesPromise = fetch(
        `/api/v1/challenges?${queryString(paginationParams)}`,
      ).then(async (res) => {
        if (!res.ok) {
          throw new LoadChallengeError('Search request failed', res.status);
        }
        const payload = (await res.json()) as ChallengeOverview[];
        return payload.map((c) => ({
          ...c,
          startTime: new Date(c.startTime),
        }));
      });

      const isPaginating =
        action === FetchAction.FORWARD || action === FetchAction.BACK;

      const statsPromise = isPaginating
        ? Promise.resolve(null)
        : fetch(`/api/v1/challenges/stats?${queryString(baseParams)}`).then(
            async (res) => {
              if (!res.ok) {
                throw new LoadChallengeError(
                  'Stats request failed',
                  res.status,
                );
              }
              return (await res.json()) as {
                '*': { count: number } | undefined;
              };
            },
          );

      const [fetchedChallenges, newStats] = await Promise.all([
        challengesPromise,
        statsPromise,
      ]);

      const totalCount = newStats?.['*']?.count ?? stats.count;

      const isBack =
        action === FetchAction.BACK || paginationParams.before !== undefined;

      const overfetched = fetchedChallenges.length > resultsPerPage;
      let newChallenges;

      if (isBack) {
        fetchedChallenges.reverse();
        newChallenges = overfetched
          ? fetchedChallenges.slice(fetchedChallenges.length - resultsPerPage)
          : fetchedChallenges;
        setHasPrevious(overfetched);
        setHasMore(true);
      } else if (action === FetchAction.FORWARD) {
        newChallenges = fetchedChallenges.slice(0, resultsPerPage);
        setHasMore(overfetched);
        setHasPrevious(true);
      } else {
        // Initial load or filter change.
        newChallenges = fetchedChallenges.slice(0, resultsPerPage);
        setHasMore(overfetched);
        setHasPrevious(
          ctx.pagination.after !== undefined ||
            ctx.pagination.before !== undefined,
        );
      }

      setChallenges(newChallenges);
      setStats({ count: totalCount });
    } catch (error) {
      lastLoadedQuery.current = null;
      if (error instanceof LoadChallengeError) {
        setLoadError(errorForStatus(error.status));
        return;
      }
      console.error('Failed to load challenges', error);
      setLoadError({
        message: 'Unable to load challenges right now.',
        details: 'Please try again later.',
      });
    } finally {
      setLoading(false);
    }
  };

  const searchParams = useSearchParams();

  useEffect(() => {
    const initialLoad = async () => {
      const initialContext = contextFromUrlParams(
        Object.fromEntries(searchParams),
      );
      const activeColumns = getLocalSetting<SelectedColumn[]>(
        'search-active-columns',
        DEFAULT_SELECTED_COLUMNS,
      );
      initialContext.extraFields = extraFieldsForColumns(activeColumns);
      await loadChallenges(FetchAction.LOAD, initialContext);
      setContext(initialContext);
      setInitialFetch(false);
    };
    void initialLoad();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!initialFetch) {
      void loadChallenges(FetchAction.LOAD);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context, initialFetch]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        loading ||
        loadError !== null ||
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLButtonElement
      ) {
        return;
      }

      if (e.key === 'ArrowLeft' && hasPrevious) {
        void loadChallenges(FetchAction.BACK);
      } else if (e.key === 'ArrowRight' && hasMore) {
        void loadChallenges(FetchAction.FORWARD);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context, challenges, loading, loadError, hasPrevious, hasMore]);

  return (
    <>
      <div className={styles.challenges}>
        <Table
          challenges={challenges}
          context={context}
          setContext={setContext}
          loading={loading}
          totalCount={stats.count}
          loadError={loadError}
          onRetry={() => void loadChallenges(FetchAction.LOAD)}
        />
        <div className={styles.pagination}>
          <div className={styles.controls}>
            <button
              disabled={loading || loadError !== null || !hasPrevious}
              onClick={() => void loadChallenges(FetchAction.BACK)}
            >
              <i className="fas fa-chevron-left" />
              <span>Back</span>
            </button>
            <button
              disabled={loading || loadError !== null || !hasMore}
              onClick={() => void loadChallenges(FetchAction.FORWARD)}
            >
              <span>Next</span>
              <i className="fas fa-chevron-right" />
            </button>
          </div>
        </div>
      </div>
      <FilterPanel
        onReset={() => setContext(resetChallengeFilters)}
        canReset={!isDefaultSearchFilters(context.filters)}
      >
        <Filters context={context} setContext={setContext} loading={loading} />
      </FilterPanel>
    </>
  );
}
