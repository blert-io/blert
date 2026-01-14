'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { SessionWithChallenges } from '@/actions/challenge';
import Card from '@/components/card';
import { SessionList } from '@/components/session-history';
import { queryString } from '@/utils/url';

import {
  SessionSearchContext,
  contextFromUrlParams,
  emptyContext,
  filtersToUrlParams,
} from './context';
import Filters from './filters';

import styles from './style.module.scss';

const RESULTS_PER_PAGE = 20;

type FilteredStats = {
  count: number;
};

type SearchProps = {
  initialContext: SessionSearchContext;
  initialSessions: SessionWithChallenges[];
  initialStats: FilteredStats;
  initialRemaining: number;
};

class LoadSessionError extends Error {
  public readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'LoadSessionError';
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

function sessionsQueryParams(
  context: SessionSearchContext,
  sessions: SessionWithChallenges[],
  action: FetchAction,
): string {
  const params = filtersToUrlParams(context.filters);
  const includeStatus = context.filters.status.length === 0;

  let keySession: SessionWithChallenges | null = null;
  if (action === FetchAction.FORWARD && sessions.length > 0) {
    keySession = sessions[sessions.length - 1];
  } else if (action === FetchAction.BACK && sessions.length > 0) {
    keySession = sessions[0];
  }

  const cursorValues: (number | string)[] = [];
  if (keySession !== null) {
    if (includeStatus) {
      cursorValues.push(keySession.status);
    }
    cursorValues.push(keySession.startTime.getTime());
  }

  if (action === FetchAction.LOAD) {
    params.after = context.pagination.after;
    params.before = context.pagination.before;
  } else if (action === FetchAction.BACK && keySession !== null) {
    params.before = cursorValues;
  } else if (action === FetchAction.FORWARD && keySession !== null) {
    params.after = cursorValues;
  }

  return queryString(params);
}

export default function SessionSearch({
  initialContext,
  initialSessions,
  initialStats,
  initialRemaining,
}: SearchProps) {
  const [initialFetch, setInitialFetch] = useState(true);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<LoadErrorState | null>(null);

  const [context, setContext] = useState(initialContext);
  // Ensure dates are Date objects (they may be strings from server serialization)
  const [sessions, setSessions] = useState<SessionWithChallenges[]>(() =>
    initialSessions.map((s) => ({
      ...s,
      startTime: new Date(s.startTime),
      endTime: s.endTime ? new Date(s.endTime) : null,
    })),
  );
  const [stats, setStats] = useState<FilteredStats>(initialStats);
  const [remaining, setRemaining] = useState(initialRemaining);

  const offset = stats.count - remaining;
  const page = Math.ceil(offset / RESULTS_PER_PAGE);
  const totalPages = Math.ceil(stats.count / RESULTS_PER_PAGE);

  console.log(
    'RENDER',
    'offset',
    offset,
    'stats.count',
    stats.count,
    'remaining',
    remaining,
    'page',
    page,
    'totalPages',
    totalPages,
  );

  const filtersEmpty =
    context.filters.type.length === 0 &&
    context.filters.mode.length === 0 &&
    context.filters.scale.length === 0 &&
    context.filters.status.length === 0 &&
    context.filters.party.length === 0 &&
    context.filters.startDate === null &&
    context.filters.endDate === null;

  const errorForStatus = (status?: number): LoadErrorState => {
    if (status === 429) {
      return {
        message: 'Search temporarily rate limited',
        details:
          'Too many requests hit the server. Please wait a few seconds and try again.',
      };
    }

    return {
      message: 'Unable to load sessions right now.',
      details: 'Please refresh the page or adjust your filters and retry.',
    };
  };

  const loadSessions = async (
    action: FetchAction = FetchAction.LOAD,
    ctx: SessionSearchContext = context,
  ) => {
    const queryParams = sessionsQueryParams(ctx, sessions, action);

    const updatedUrl = `/search/sessions?${queryParams}`;
    window.history.replaceState(null, '', updatedUrl);

    setLoading(true);
    setLoadError(null);

    try {
      const response = await fetch(
        `/api/v1/sessions?${queryParams}&limit=${RESULTS_PER_PAGE}`,
      );

      if (!response.ok) {
        throw new LoadSessionError('Sessions request failed', response.status);
      }

      const totalCount = parseInt(
        response.headers.get('X-Total-Count') ?? '0',
        10,
      );
      const remainingCountHeader = response.headers.get('X-Remaining-Count');
      const remainingCount = remainingCountHeader
        ? parseInt(remainingCountHeader, 10)
        : Number.NaN;
      const payload = (await response.json()) as SessionWithChallenges[];
      const parsed = payload.map((s) => ({
        ...s,
        startTime: new Date(s.startTime),
        endTime: s.endTime ? new Date(s.endTime) : null,
      }));
      const shouldReverse =
        action === FetchAction.BACK ||
        (action === FetchAction.LOAD && ctx.pagination.before !== undefined);

      console.log(
        'totalCount',
        totalCount,
        'offset',
        offset,
        'parsed.length',
        parsed.length,
        'remaining (before)',
        remaining,
      );

      if (shouldReverse) {
        parsed.reverse();
      }

      if (Number.isNaN(remainingCount)) {
        setRemaining(Math.max(totalCount - parsed.length, 0));
      } else {
        setRemaining(remainingCount);
      }

      setSessions(parsed);
      setStats({ count: totalCount });
    } catch (error) {
      if (error instanceof LoadSessionError) {
        setLoadError(errorForStatus(error.status));
        return;
      }
      console.error('Failed to load sessions', error);
      setLoadError({
        message: 'Unable to load sessions right now.',
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
      await loadSessions(FetchAction.LOAD, initialContext);
      setContext(initialContext);
      setInitialFetch(false);
    };
    void initialLoad();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!initialFetch) {
      void loadSessions(FetchAction.LOAD);
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
        void loadSessions(FetchAction.BACK);
      } else if (e.key === 'ArrowRight' && page < totalPages) {
        void loadSessions(FetchAction.FORWARD);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context, sessions, loading, loadError, page, totalPages]);

  return (
    <div className={styles.sessionSearch}>
      <Card
        className={styles.filtersCard}
        fixed
        header={{
          title: <span className={styles.filtersTitle}>Filters</span>,
          action: (
            <button
              className={styles.clearAllButton}
              disabled={loading || filtersEmpty}
              onClick={() => setContext(emptyContext())}
            >
              Clear all
            </button>
          ),
        }}
      >
        <Filters context={context} setContext={setContext} loading={loading} />
      </Card>
      <Card
        className={styles.resultsCard}
        fixed
        header={{
          title: (
            <span className={styles.resultsTitle}>
              <i className="fas fa-layer-group" />
              Sessions
              {stats.count > 0 && (
                <span className={styles.totalCount}>({stats.count} total)</span>
              )}
            </span>
          ),
        }}
      >
        {loadError !== null ? (
          <div className={styles.loadError}>
            <i className="fas fa-exclamation-triangle" />
            <p className={styles.title}>{loadError.message}</p>
            {loadError.details && (
              <p className={styles.details}>{loadError.details}</p>
            )}
            <button onClick={() => void loadSessions(FetchAction.LOAD)}>
              <i className="fas fa-redo" />
              Retry
            </button>
          </div>
        ) : sessions.length === 0 && !loading ? (
          <div className={styles.emptyState}>
            <i className="fas fa-bed" />
            <p className={styles.title}>No sessions found</p>
            <p className={styles.hint}>
              Try adjusting your filters or search criteria.
            </p>
          </div>
        ) : (
          <div className={styles.sessionsList}>
            <SessionList
              count={RESULTS_PER_PAGE}
              sessions={sessions}
              isLoading={loading}
            />
          </div>
        )}

        {stats.count > 0 && (
          <div className={styles.pagination}>
            <div className={styles.controls}>
              <button
                disabled={loading || loadError !== null || page <= 1}
                onClick={() => void loadSessions(FetchAction.BACK)}
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
                onClick={() => void loadSessions(FetchAction.FORWARD)}
              >
                <i className="fas fa-chevron-right" />
                <span className="sr-only">Next</span>
              </button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
