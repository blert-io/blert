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

  const sortValues: Array<number | string> = [];

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

  const [context, setContext] = useState(initialContext);
  const [challenges, setChallenges] =
    useState<ChallengeOverview[]>(initialChallenges);
  const [stats, setStats] = useState<FilteredStats>(initialStats);
  const [remaining, setRemaining] = useState(initialRemaining);

  const resultsPerPage = 25; // TODO(frolv): Make this configurable.
  const offset = stats.count - remaining;

  const page = Math.floor(offset / resultsPerPage) + 1;
  const totalPages = Math.ceil(stats.count / resultsPerPage);

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

    try {
      const [[newChallenges, newRemaining], newStats] = await Promise.all([
        fetch(`/api/v1/challenges?${queryString(paginationParams)}`).then(
          async (res) => {
            if (res.ok) {
              const rem = res.headers.get('X-Total-Count');
              return [
                await res.json().then((cs) =>
                  cs.map((c: any) => ({
                    ...c,
                    startTime: new Date(c.startTime),
                  })),
                ),
                rem !== null ? parseInt(rem) : null,
              ];
            }
            return [[], null];
          },
        ),
        fetch(`/api/v1/challenges/stats?${queryString(baseParams)}`).then(
          (res) => res.json(),
        ),
      ]);

      setLoading(false);

      if (
        action === FetchAction.BACK ||
        paginationParams.before !== undefined
      ) {
        newChallenges.reverse();
        setRemaining(newStats['*'].count - newRemaining + resultsPerPage);
      } else {
        setRemaining(newRemaining);
      }

      setChallenges(newChallenges);
      setStats({ count: newStats['*'].count });
    } catch (e) {
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
    initialLoad();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!initialFetch) {
      loadChallenges(FetchAction.LOAD);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context, initialFetch]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        loading ||
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLButtonElement
      ) {
        return;
      }

      if (e.key === 'ArrowLeft' && page > 1) {
        loadChallenges(FetchAction.BACK);
      } else if (e.key === 'ArrowRight' && page < totalPages) {
        loadChallenges(FetchAction.FORWARD);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context, challenges, loading, page, totalPages]);

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
        />
        <div className={styles.pagination}>
          <div className={styles.controls}>
            <button
              disabled={loading || page <= 1}
              onClick={() => loadChallenges(FetchAction.BACK)}
            >
              <i className="fas fa-chevron-left" />
              <span className="sr-only">Previous</span>
            </button>
            <p>
              Page {page}
              {totalPages > 0 && ` of ${totalPages}`}
            </p>
            <button
              disabled={loading || page >= totalPages}
              onClick={() => loadChallenges(FetchAction.FORWARD)}
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
