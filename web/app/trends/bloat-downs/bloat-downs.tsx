'use client';

import { ChallengeMode } from '@blert/common';
import {
  Dispatch,
  SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { BloatDownsResponse } from '@/actions/theatre';
import { Comparator } from '@/components/comparable-input';
import { useDebounced } from '@/hooks/debounce';
import { scaleNameAndColor } from '@/utils/challenge';
import { getOrdinal } from '@/utils/path-util';

import BloatDownsChart from './chart';
import BloatDownsControls, {
  BloatDownsFilters,
  DEFAULT_FILTERS,
} from './controls';
import BloatDownsTable from './table';

import styles from './style.module.scss';

const SERIES_A_COLOR = 'var(--blert-purple)';
const SERIES_B_COLOR = 'var(--blert-yellow)';

const FILTER_DEBOUNCE_MS = 350;

export type SeriesId = 'a' | 'b';

export type Series = {
  id: SeriesId;
  label: string;
  color: string;
  data: BloatDownsResponse | null;
};

const SERIES_DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
});

const SERIES_DATE_FORMAT_WITH_YEAR = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

function formatSeriesDate(date: Date): string {
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  return date < oneYearAgo
    ? SERIES_DATE_FORMAT_WITH_YEAR.format(date)
    : SERIES_DATE_FORMAT.format(date);
}

function comparatorSymbol(c: Comparator): string {
  switch (c) {
    case Comparator.EQUAL:
      return '';
    case Comparator.LESS_THAN:
      return '<';
    case Comparator.GREATER_THAN:
      return '>';
    case Comparator.LESS_THAN_OR_EQUAL:
      return '\u2264';
    case Comparator.GREATER_THAN_OR_EQUAL:
      return '\u2265';
  }
}

function seriesName(filters: BloatDownsFilters): string {
  const parts: string[] = [];

  parts.push(filters.mode === ChallengeMode.TOB_REGULAR ? 'Reg' : 'HMT');
  if (filters.scale !== null) {
    parts.push(scaleNameAndColor(filters.scale)[0]);
  }

  if (filters.downNumber !== null) {
    parts.push(
      `${comparatorSymbol(filters.downComparator)}${getOrdinal(filters.downNumber)} down`,
    );
  } else {
    parts.push('all downs');
  }

  if (filters.startDate !== null && filters.endDate !== null) {
    parts.push(
      `${formatSeriesDate(filters.startDate)}\u2013${formatSeriesDate(filters.endDate)}`,
    );
  } else if (filters.startDate !== null) {
    parts.push(`since ${formatSeriesDate(filters.startDate)}`);
  } else if (filters.endDate !== null) {
    parts.push(`until ${formatSeriesDate(filters.endDate)}`);
  }

  return parts.join(' ');
}

function comparatorPrefix(c: Comparator): string {
  switch (c) {
    case Comparator.EQUAL:
      return 'eq';
    case Comparator.LESS_THAN:
      return 'lt';
    case Comparator.GREATER_THAN:
      return 'gt';
    case Comparator.LESS_THAN_OR_EQUAL:
      return 'le';
    case Comparator.GREATER_THAN_OR_EQUAL:
      return 'ge';
  }
}

function buildQueryString(filters: BloatDownsFilters): string {
  const params = new URLSearchParams();
  params.set('mode', filters.mode.toString());
  if (filters.scale !== null) {
    params.set('scale', filters.scale.toString());
  }
  if (filters.downNumber !== null) {
    params.set(
      'downNumber',
      `${comparatorPrefix(filters.downComparator)}${filters.downNumber}`,
    );
  }
  if (filters.startDate !== null && filters.endDate !== null) {
    const endDate = new Date(filters.endDate);
    endDate.setDate(endDate.getDate() + 1);
    params.set(
      'startTime',
      `${filters.startDate.getTime()}..${endDate.getTime()}`,
    );
  } else if (filters.startDate !== null) {
    params.set('startTime', `ge${filters.startDate.getTime()}`);
  } else if (filters.endDate !== null) {
    const endDate = new Date(filters.endDate);
    endDate.setDate(endDate.getDate() + 1);
    params.set('startTime', `lt${endDate.getTime()}`);
  }
  return params.toString();
}

function useBloatDowns(filters: BloatDownsFilters | null) {
  const [data, setData] = useState<BloatDownsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (filters === null) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const query = buildQueryString(filters);
      const response = await fetch(`/api/v1/trends/bloat-downs?${query}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch data: ${response.status}`);
      }
      const result = (await response.json()) as BloatDownsResponse;
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch data');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  return { data, loading, error, refetch: fetchData };
}

function ErrorBlock({
  label,
  onRetry,
}: {
  label: string;
  onRetry: () => void;
}) {
  return (
    <div className={styles.errorState}>
      <div className={styles.errorIcon}>
        <i className="fas fa-exclamation-circle" />
      </div>
      <div className={styles.errorContent}>
        <h3>Failed to load {label}</h3>
        <p>There was a problem fetching the distribution.</p>
      </div>
      <button onClick={onRetry} className={styles.retryButton}>
        <i className="fas fa-sync-alt" /> Try Again
      </button>
    </div>
  );
}

export default function BloatDowns() {
  const [filtersA, setFiltersA] = useState<BloatDownsFilters>(DEFAULT_FILTERS);
  const [filtersB, setFiltersB] = useState<BloatDownsFilters | null>(null);

  const debouncedFiltersA = useDebounced(filtersA, FILTER_DEBOUNCE_MS);
  const debouncedFiltersB = useDebounced(filtersB, FILTER_DEBOUNCE_MS);

  const {
    data: dataA,
    loading: loadingA,
    error: errorA,
    refetch: refetchA,
  } = useBloatDowns(debouncedFiltersA);
  const {
    data: dataB,
    loading: loadingB,
    error: errorB,
    refetch: refetchB,
  } = useBloatDowns(debouncedFiltersB);

  const series = useMemo<Series[]>(() => {
    const result: Series[] = [
      {
        id: 'a',
        label: seriesName(debouncedFiltersA),
        color: SERIES_A_COLOR,
        data: dataA,
      },
    ];
    if (debouncedFiltersB !== null) {
      result.push({
        id: 'b',
        label: seriesName(debouncedFiltersB),
        color: SERIES_B_COLOR,
        data: dataB,
      });
    }
    return result;
  }, [dataA, dataB, debouncedFiltersA, debouncedFiltersB]);

  const enableComparison = () => {
    setFiltersB({ ...filtersA });
  };

  const removeComparison = () => {
    setFiltersB(null);
  };

  const anyLoading = loadingA || loadingB;
  const anyError = errorA !== null || (filtersB !== null && errorB !== null);
  const bothReady = dataA !== null && (filtersB === null || dataB !== null);

  return (
    <>
      <div className={styles.seriesBlock}>
        <div className={styles.seriesHeader}>
          <div className={styles.seriesLabel}>
            <span
              className={styles.swatch}
              style={{ background: SERIES_A_COLOR }}
            />
            {seriesName(filtersA)}
          </div>
        </div>
        <BloatDownsControls
          idPrefix="series-a"
          filters={filtersA}
          setFilters={setFiltersA}
        />
      </div>

      {filtersB !== null ? (
        <div className={styles.seriesBlock}>
          <div className={styles.seriesHeader}>
            <div className={styles.seriesLabel}>
              <span
                className={styles.swatch}
                style={{ background: SERIES_B_COLOR }}
              />
              {seriesName(filtersB)}
            </div>
            <button
              type="button"
              className={styles.removeButton}
              onClick={removeComparison}
            >
              <i className="fas fa-times" /> Remove comparison
            </button>
          </div>
          <BloatDownsControls
            idPrefix="series-b"
            filters={filtersB}
            setFilters={
              setFiltersB as Dispatch<SetStateAction<BloatDownsFilters>>
            }
          />
        </div>
      ) : (
        <button
          type="button"
          className={styles.compareButton}
          onClick={enableComparison}
        >
          <i className="fas fa-plus" /> Add comparison series
        </button>
      )}

      <div className={styles.chartSection}>
        {anyError && !anyLoading ? (
          <ErrorBlock
            label="bloat down data"
            onRetry={() => {
              if (errorA !== null) {
                void refetchA();
              }
              if (errorB !== null) {
                void refetchB();
              }
            }}
          />
        ) : anyLoading || !bothReady ? (
          <>
            <div className={styles.skeletonChart} />
            <div className={styles.skeletonTable} />
          </>
        ) : (
          <>
            <div className={styles.chartWrapper}>
              <BloatDownsChart series={series} />
            </div>
            <BloatDownsTable series={series} />
          </>
        )}
      </div>
    </>
  );
}
