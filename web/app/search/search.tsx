'use client';

import { useEffect, useState } from 'react';

import {
  BasicSortableFields,
  ChallengeOverview,
  SortableFields,
} from '@/actions/challenge';
import CollapsiblePanel from '@/components/collapsible-panel';
import { queryString } from '@/utils/url';

import {
  SearchContext,
  extraFieldsToUrlParam,
  filtersToUrlParams,
} from './context';
import Filters from './filters';
import Table from './table';

import styles from './style.module.scss';
import { SplitType } from '@blert/common';

type FilteredStats = {
  count: number;
};

type SearchProps = {
  initialContext: SearchContext;
  initialChallenges: ChallengeOverview[];
  initialStats: FilteredStats;
};

enum FetchAction {
  LOAD,
  FORWARD,
  BACK,
}

type ChallengesResult = {
  challenges: ChallengeOverview[];
  remaining: number;
  stats: FilteredStats;
};

function getSortKeyValue(challenge: ChallengeOverview, key: SortableFields) {
  if (key.startsWith('splits:')) {
    const split = Number.parseInt(key.slice(7)) as SplitType;
    return challenge.splits?.[split]?.ticks ?? null;
  }

  const k = key as BasicSortableFields;
  return challenge[k];
}

async function fetchChallenges(
  context: SearchContext,
  challenges: ChallengeOverview[],
  limit: number,
  action: FetchAction = FetchAction.LOAD,
): Promise<ChallengesResult> {
  let allParams = filtersToUrlParams(context.filters);
  allParams.sort = [];

  const params: Record<string, any> = {
    ...allParams,
    limit,
    extraFields: extraFieldsToUrlParam(context.extraFields),
  };

  // `q` is a custom query string which allows more complex expressions.
  // It is used for pagination by using sort key(s) to track the current
  // position in the result set.
  const q = [];
  let sortFieldAndValue: [SortableFields, any] | null = null;

  // Depending on the pagination direction, use the first or last challenge as
  // the base for the sort key.
  let keyChallenge: ChallengeOverview | null = null;
  if (action === FetchAction.FORWARD && challenges.length > 0) {
    keyChallenge = challenges[challenges.length - 1];
  } else if (action === FetchAction.BACK && challenges.length > 0) {
    keyChallenge = challenges[0];
  }

  // Default sort by startTime descending.
  const sorts = context.sort ?? ['-startTime'];

  let hasTime = false;

  for (const sort of sorts) {
    const sortOp = sort[0];
    const sortField = sort.slice(1) as SortableFields;

    if (sortField === 'startTime') {
      hasTime = true;
    }

    let sortDirection;
    let operator;
    let options;
    if (action === FetchAction.BACK) {
      if (sortOp === '+') {
        // Reverse the sort direction when paging backwards.
        sortDirection = '-';
        operator = '<';
      } else {
        sortDirection = '+';
        operator = '>';
      }
      options = 'nf';
    } else {
      sortDirection = sortOp;
      operator = sortOp === '+' ? '>' : '<';
      options = 'nl';
    }

    params.sort.push(`${sortDirection}${sortField}#${options}`);

    if (keyChallenge !== null) {
      const keyField = getSortKeyValue(keyChallenge, sortField);
      if (keyField !== null) {
        const keyValue =
          keyField instanceof Date ? keyField.getTime() : keyField;
        sortFieldAndValue = [sortField, keyValue];

        if (action !== FetchAction.BACK) {
          q.push(`(${sortField}${operator}${keyValue}||${sortField}==null)`);
        } else {
          q.push(`${sortField}${operator}${keyValue}`);
        }
      } else {
        sortFieldAndValue = [sortField, null];
      }
    }
  }

  if (!hasTime) {
    // Non-time fields are not unique, so always use time as a secondary sort
    // and a tiebreaker to ensure consistent ordering.
    let op;
    if (action === FetchAction.BACK) {
      params.sort.push('+startTime');
      op = '>';
    } else {
      params.sort.push('-startTime');
      op = '<';
    }

    if (keyChallenge !== null) {
      const startTime = `startTime${op}${keyChallenge.startTime.getTime()}`;
      if (sortFieldAndValue !== null) {
        const [key, value] = sortFieldAndValue;
        if (value === null && action === FetchAction.BACK) {
          // When paging backwards, null values will be first, followed by
          // non-null values, so include both conditions.
          q.push(`${key}!=null`);
          q.push(`(${key}==null&&${startTime})`);
        } else {
          q.push(`(${key}==${value}&&${startTime})`);
        }
      } else {
        q.push(startTime);
      }
    }
  }

  if (q.length > 0) {
    params.q = btoa(q.join('||'));
  }

  const [[newChallenges, remaining], newStats] = await Promise.all([
    fetch(`/api/v1/challenges?${queryString(params)}`).then(async (res) => {
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
    }),
    fetch(`/api/v1/challenges/stats?${queryString(allParams)}`).then((res) =>
      res.json(),
    ),
  ]);

  if (action === FetchAction.BACK) {
    newChallenges.reverse();
  }

  return { challenges: newChallenges, remaining, stats: newStats };
}

export default function Search({
  initialContext,
  initialChallenges,
  initialStats,
}: SearchProps) {
  const [context, setContext] = useState(initialContext);
  const [loading, setLoading] = useState(false);

  const [challenges, setChallenges] =
    useState<ChallengeOverview[]>(initialChallenges);
  const [stats, setStats] = useState<FilteredStats>(initialStats);

  const [remaining, setRemaining] = useState(initialStats.count);

  const resultsPerPage = initialChallenges.length;
  const offset = stats.count - remaining;

  const page = Math.floor(offset / resultsPerPage) + 1;
  const totalPages = Math.ceil(stats.count / resultsPerPage);

  const loadChallenges = async (action: FetchAction = FetchAction.LOAD) => {
    setLoading(true);
    const result = await fetchChallenges(
      context,
      challenges,
      resultsPerPage,
      action,
    );
    setLoading(false);

    if (action === FetchAction.BACK) {
      setRemaining((r) => r + resultsPerPage);
    } else {
      setRemaining(result.remaining);
    }

    setChallenges(result.challenges);
    setStats(result.stats);
  };

  useEffect(() => {
    loadChallenges(FetchAction.LOAD);
  }, [context]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (loading || e.target instanceof HTMLInputElement) {
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
  }, [context, challenges, loading, page, totalPages]);

  return (
    <>
      <CollapsiblePanel
        contentClassName={styles.filtersWrapper}
        defaultExpanded
        panelTitle="Filters"
        maxPanelHeight={2000}
      >
        <Filters context={context} setContext={setContext} loading={loading} />
      </CollapsiblePanel>
      <CollapsiblePanel
        panelTitle={`Challenges${stats ? ` (${stats.count})` : ''}`}
        defaultExpanded
        disableExpansion
        maxPanelWidth="min(100%, 2000px)"
        maxPanelHeight={2000}
      >
        <div className={styles.challenges}>
          <Table
            challenges={challenges}
            context={context}
            setContext={setContext}
            loading={loading}
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
      </CollapsiblePanel>
    </>
  );
}
