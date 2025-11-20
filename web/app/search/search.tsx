'use client';

import { SplitType } from '@blert/common';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import {
  BasicSortableFields,
  ChallengeOverview,
  SortableFields,
} from '@/actions/challenge';
import CollapsiblePanel from '@/components/collapsible-panel';
import { UrlParams, queryString } from '@/utils/url';

import {
  SearchContext,
  contextFromUrlParams,
  extraFieldsToUrlParam,
  filtersToUrlParams,
} from './context';
import Filters from './filters';
import Table, { extraFieldsForColumns, searchPresetsStorage } from './table';

import styles from './style.module.scss';

type FilteredStats = {
  count: number;
};

type SearchProps = {
  initialContext: SearchContext;
  initialChallenges: ChallengeOverview[];
  initialStats: FilteredStats;
  initialRemaining: number;
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
  initialRemaining,
}: SearchProps) {
  const [initialFetch, setInitialFetch] = useState(true);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<LoadErrorState | null>(null);

  const [context, setContext] = useState(initialContext);
  const [challenges, setChallenges] =
    useState<ChallengeOverview[]>(initialChallenges);
  const [stats, setStats] = useState<FilteredStats>(initialStats);
  const [remaining, setRemaining] = useState(initialRemaining);

  const resultsPerPage = 25; // TODO(frolv): Make this configurable.
  const offset = stats.count - remaining;

  const page = Math.floor(offset / resultsPerPage) + 1;
  const totalPages = Math.ceil(stats.count / resultsPerPage);

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

    const updatedUrl = `/search?${queryString(paginationParams)}`;
    window.history.replaceState(null, '', updatedUrl);

    paginationParams.limit = resultsPerPage;
    paginationParams.extraFields = extraFieldsToUrlParam(ctx.extraFields);

    setLoading(true);
    setLoadError(null);

    try {
      const [[newChallenges, newRemaining], newStats] = await Promise.all([
        fetch(`/api/v1/challenges?${queryString(paginationParams)}`).then(
          async (res) => {
            if (!res.ok) {
              throw new LoadChallengeError('Search request failed', res.status);
            }
            const rem = res.headers.get('X-Total-Count');
            const payload = (await res.json()) as ChallengeOverview[];
            const parsed = payload.map((c) => ({
              ...c,
              startTime: new Date(c.startTime),
            }));
            return [
              parsed,
              rem !== null && !Number.isNaN(parseInt(rem, 10))
                ? parseInt(rem, 10)
                : null,
            ] as [ChallengeOverview[], number | null];
          },
        ),
        fetch(`/api/v1/challenges/stats?${queryString(baseParams)}`).then(
          async (res) => {
            if (!res.ok) {
              throw new LoadChallengeError('Stats request failed', res.status);
            }
            return (await res.json()) as { '*': { count: number } | undefined };
          },
        ),
      ]);

      const totalCount = newStats['*']?.count ?? 0;

      if (
        action === FetchAction.BACK ||
        paginationParams.before !== undefined
      ) {
        newChallenges.reverse();
        setRemaining(
          newRemaining !== null
            ? totalCount - newRemaining + resultsPerPage
            : totalCount,
        );
      } else {
        setRemaining(newRemaining ?? totalCount);
      }

      setChallenges(newChallenges);
      setStats({ count: totalCount });
    } catch (error) {
      if (error instanceof LoadChallengeError) {
        setLoadError(errorForStatus(error.status));
        return;
      }
      console.error('Failed to load challenges', error);
      setLoadError({
        message: 'Unable to load challenges right now.',
        details: 'Please try again later.',
      });
      return;
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
      const presets = searchPresetsStorage.get();
      if (presets.activeColumns) {
        initialContext.extraFields = extraFieldsForColumns(
          presets.activeColumns,
        );
      }
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

      if (e.key === 'ArrowLeft' && page > 1) {
        void loadChallenges(FetchAction.BACK);
      } else if (e.key === 'ArrowRight' && page < totalPages) {
        void loadChallenges(FetchAction.FORWARD);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context, challenges, loading, loadError, page, totalPages]);

  return (
    <>
      <CollapsiblePanel
        defaultExpanded
        panelTitle="Filters"
        maxPanelHeight={2000}
      >
        <Filters context={context} setContext={setContext} loading={loading} />
      </CollapsiblePanel>
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
              disabled={loading || loadError !== null || page <= 1}
              onClick={() => void loadChallenges(FetchAction.BACK)}
            >
              <i className="fas fa-chevron-left" />
              <span className="sr-only">Previous</span>
            </button>
            <p>
              Page {page}
              {totalPages > 0 && ` of ${totalPages}`}
            </p>
            <button
              disabled={loading || loadError !== null || page >= totalPages}
              onClick={() => void loadChallenges(FetchAction.FORWARD)}
            >
              <i className="fas fa-chevron-right" />
              <span className="sr-only">Next</span>
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
