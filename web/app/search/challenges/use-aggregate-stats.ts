'use client';

import { useEffect, useState } from 'react';

import { SortableFields } from '@/actions/challenge';
import { SortQuery } from '@/actions/query';
import { queryString } from '@/utils/url';

import {
  SearchFilters,
  filtersToUrlParams,
  implicitSplitFilters,
} from './context';

export type ColumnAggregates = {
  count: number;
  avg: number | null;
  p50: number | null;
};

export type AggregateStats = Record<string, ColumnAggregates>;

export type AggregateStatsState = {
  stats: AggregateStats | null;
  loading: boolean;
  error: boolean;
};

/**
 * Builds the stats query string for the given filters and aggregatable fields,
 * fetching each field's sample size, mean, and median.
 */
export function aggregateStatsQuery(
  filters: SearchFilters,
  fields: string[],
  sort: SortQuery<SortableFields>[],
): string {
  if (fields.length === 0) {
    return '';
  }
  const search = new URLSearchParams(queryString(filtersToUrlParams(filters)));
  // Match the implicit split filter the query applies so the footer
  // summarizes the same set of challenges.
  for (const [key, value] of Object.entries(
    implicitSplitFilters(filters, sort),
  )) {
    if (!search.has(key)) {
      search.set(key, value);
    }
  }
  for (const field of fields) {
    search.append('aggregate', `${field}:count,avg,p50`);
  }
  return search.toString();
}

const AGGREGATE_DEBOUNCE_MS = 500;

/**
 * Fetches summary statistics for the given fields over the current filter set.
 */
export function useAggregateStats(
  filters: SearchFilters,
  fields: string[],
  sort: SortQuery<SortableFields>[],
  debounceMs = AGGREGATE_DEBOUNCE_MS,
): AggregateStatsState {
  const [state, setState] = useState<AggregateStatsState>({
    stats: null,
    loading: false,
    error: false,
  });

  const query = aggregateStatsQuery(filters, fields, sort);

  useEffect(() => {
    if (query === '') {
      setState({ stats: null, loading: false, error: false });
      return;
    }

    let active = true;
    const controller = new AbortController();
    // Show the loading state immediately so the footer never displays stale
    // numbers during the debounce window, then defer the request itself.
    setState({ stats: null, loading: true, error: false });

    const timer = setTimeout(() => {
      fetch(`/api/v1/challenges/stats?${query}`, { signal: controller.signal })
        .then((res) => {
          if (!res.ok) {
            throw new Error(`Stats request failed: ${res.status}`);
          }
          return res.json() as Promise<AggregateStats>;
        })
        .then((stats) => {
          if (active) {
            setState({ stats, loading: false, error: false });
          }
        })
        .catch((error) => {
          if (!active) {
            return;
          }
          console.error('Failed to load aggregate stats', error);
          setState({ stats: null, loading: false, error: true });
        });
    }, debounceMs);

    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, debounceMs]);

  return state;
}
