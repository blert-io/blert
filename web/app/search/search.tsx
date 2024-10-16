'use client';

import { useEffect, useState } from 'react';

import { ChallengeOverview, SortableFields } from '@/actions/challenge';
import CollapsiblePanel from '@/components/collapsible-panel';
import { queryString } from '@/utils/url';

import { SearchContext, filtersToUrlParams } from './context';
import Filters from './filters';
import Table from './table';

import styles from './style.module.scss';

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
  const totalPages = stats ? Math.ceil(stats.count / resultsPerPage) : null;

  const fetchChallenges = async (action: FetchAction = FetchAction.LOAD) => {
    let allParams = filtersToUrlParams(context.filters);
    allParams.sort = [];

    const params: Record<string, any> = { ...allParams, limit: resultsPerPage };

    // `q` is a custom query string which allows more complex expressions.
    // It is used for pagination by using sort key(s) to track the current
    // position in the result set.
    const q = [];
    const sortFields = [];

    // Depending on the pagination direction, use the first or last challenge as
    // the base for the sort key.
    let keyChallenge: ChallengeOverview | null = null;
    if (action === FetchAction.FORWARD && challenges.length > 0) {
      keyChallenge = challenges[challenges.length - 1];
    } else if (action === FetchAction.BACK && challenges.length > 0) {
      keyChallenge = challenges[0];
    }
    const sorts = context.sort ?? ['-startTime']; // Default sort by startTime descending.

    let hasTime = false;

    for (const sort of sorts) {
      const sortOp = sort[0];
      const sortField = sort.slice(1) as SortableFields;

      if (sortField === 'startTime') {
        hasTime = true;
      }

      let sortDirection;
      let operator;
      if (action === FetchAction.BACK) {
        // Reverse the sort direction when paging backwards.
        sortDirection = sortOp === '+' ? '-' : '+';
        operator = sortOp === '+' ? '<' : '>';
      } else {
        sortDirection = sortOp;
        operator = sortOp === '+' ? '>' : '<';
      }

      params.sort.push(`${sortDirection}${sortField}`);

      if (keyChallenge !== null) {
        const keyField = keyChallenge[sortField];
        const keyValue =
          keyField instanceof Date ? keyField.getTime() : keyField;
        sortFields.push([sortField, keyValue]);
        q.push(`${sortField}${operator}${keyValue}`);
      }
    }

    if (!hasTime) {
      // Non-time fields are not unique, so always use time as a secondary sort
      // and a tiebreaker to ensure consistent ordering.
      let op;
      if (action === FetchAction.BACK) {
        params.sort.push('-startTime');
        op = '<';
      } else {
        params.sort.push('+startTime');
        op = '>';
      }

      if (keyChallenge !== null) {
        const equal = sortFields
          .map(([key, value]) => `${key}==${value}`)
          .join('&&');
        q.push(`(${equal}&&startTime${op}${keyChallenge.startTime.getTime()})`);
      }
    }

    if (q.length > 0) {
      params.q = btoa(q.join('||'));
    }

    setLoading(true);
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
    setLoading(false);

    if (action === FetchAction.BACK) {
      setRemaining((r) => r + resultsPerPage);
      newChallenges.reverse();
    } else {
      setRemaining(remaining);
    }

    setChallenges(newChallenges);
    setStats(newStats);
  };

  useEffect(() => {
    fetchChallenges(FetchAction.LOAD);
  }, [context]);

  return (
    <>
      <CollapsiblePanel
        panelTitle="Filters"
        defaultExpanded
        maxPanelHeight={2000}
      >
        <Filters context={context} setContext={setContext} loading={loading} />
      </CollapsiblePanel>
      <CollapsiblePanel
        panelTitle={`Challenges${stats ? ` (${stats.count})` : ''}`}
        defaultExpanded
        disableExpansion
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
                disabled={loading || page === 1}
                onClick={() => fetchChallenges(FetchAction.BACK)}
              >
                <i className="fas fa-chevron-left" />
                <span className="sr-only">Previous</span>
              </button>
              <p>
                Page {page}
                {totalPages && ` of ${totalPages}`}
              </p>
              <button
                disabled={loading || page === totalPages}
                onClick={() => fetchChallenges(FetchAction.FORWARD)}
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
