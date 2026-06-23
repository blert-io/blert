/**
 * @jest-environment jsdom
 */
import { ChallengeStatus } from '@blert/common';
import { act, renderHook } from '@testing-library/react';

import { Comparator } from '@/components/tick-input';

import { defaultSearchFilters } from '../context';
import {
  aggregateStatsQuery,
  AggregateStats,
  useAggregateStats,
} from '../use-aggregate-stats';

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function jsonResponse(data: AggregateStats): Response {
  return { ok: true, json: () => Promise.resolve(data) } as unknown as Response;
}

describe('useAggregateStats', () => {
  const realFetch = global.fetch;

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    global.fetch = realFetch;
  });

  it('discards a superseded response that resolves after the query changes', async () => {
    const debounceMs = 200;

    const stale = deferred<Response>();
    const fresh = deferred<Response>();
    const fetchMock = jest
      .fn()
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(fresh.promise);
    global.fetch = fetchMock as unknown as typeof fetch;

    const filters = defaultSearchFilters();
    const { result, rerender } = renderHook(
      ({ fields }) => useAggregateStats(filters, fields, [], debounceMs),
      { initialProps: { fields: ['challengeTicks'] } },
    );

    // Fire the first request, then supersede it before it resolves.
    await act(async () => {
      jest.advanceTimersByTime(debounceMs);
    });
    rerender({ fields: ['overallTicks'] });
    await act(async () => {
      jest.advanceTimersByTime(debounceMs);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const freshStats: AggregateStats = {
      overallTicks: { count: 5, avg: 100, p50: 90 },
    };
    const staleStats: AggregateStats = {
      challengeTicks: { count: 9, avg: 700, p50: 250 },
    };

    // The current request settles first, then the superseded one resolves last,
    // which should be ignored.
    await act(async () => {
      fresh.resolve(jsonResponse(freshStats));
    });
    await act(async () => {
      stale.resolve(jsonResponse(staleStats));
    });

    expect(result.current.stats).toEqual(freshStats);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe(false);
  });

  it('coalesces a burst of query changes into a single request', async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse({}));
    global.fetch = fetchMock as unknown as typeof fetch;

    const debounceMs = 200;

    const filters = defaultSearchFilters();
    const { rerender } = renderHook(
      ({ fields }) => useAggregateStats(filters, fields, [], debounceMs),
      { initialProps: { fields: ['challengeTicks'] } },
    );

    // Three changes, each landing before the previous debounce elapses.
    for (const fields of [['overallTicks'], ['totalDeaths']]) {
      await act(async () => {
        jest.advanceTimersByTime(debounceMs - 100);
      });
      rerender({ fields });
    }
    await act(async () => {
      jest.advanceTimersByTime(debounceMs - 100);
    });
    expect(fetchMock).not.toHaveBeenCalled();

    // Only a single request is made.
    await act(async () => {
      jest.advanceTimersByTime(debounceMs);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('totalDeaths'),
      expect.anything(),
    );
  });
});

describe('aggregateStatsQuery', () => {
  it('returns an empty string when there are no fields', () => {
    expect(aggregateStatsQuery(defaultSearchFilters(), [], [])).toBe('');
  });

  it('emits one repeated aggregate parameter per field', () => {
    const query = aggregateStatsQuery(
      defaultSearchFilters(),
      ['challengeTicks', 'splits:102', 'tob:verzikRedsCount'],
      [],
    );
    expect(new URLSearchParams(query).getAll('aggregate')).toEqual([
      'challengeTicks:count,avg,p50',
      'splits:102:count,avg,p50',
      'tob:verzikRedsCount:count,avg,p50',
    ]);
  });

  it('includes the active filters alongside the aggregates', () => {
    const filters = defaultSearchFilters();
    filters.status = [ChallengeStatus.COMPLETED];

    const params = new URLSearchParams(
      aggregateStatsQuery(filters, ['challengeTicks'], []),
    );
    expect(params.get('status')).toBe(String(ChallengeStatus.COMPLETED));
    expect(params.getAll('aggregate')).toEqual([
      'challengeTicks:count,avg,p50',
    ]);
  });

  it('forwards the implicit split filter when sorting by a split', () => {
    const params = new URLSearchParams(
      aggregateStatsQuery(
        defaultSearchFilters(),
        ['splits:13'],
        ['-splits:13'],
      ),
    );
    expect(params.get('split:13')).toBe('ge0');
  });

  it('omits the implicit split filter when accurate splits are off', () => {
    const filters = defaultSearchFilters();
    filters.accurateSplits = false;

    const params = new URLSearchParams(
      aggregateStatsQuery(filters, ['splits:13'], ['-splits:13']),
    );
    expect(params.has('split:13')).toBe(false);
  });

  it('keeps an explicit split filter over the implicit one', () => {
    const filters = defaultSearchFilters();
    filters.splits.set(13, [Comparator.LESS_THAN, 100]);

    const params = new URLSearchParams(
      aggregateStatsQuery(filters, ['splits:13'], ['-splits:13']),
    );
    expect(params.get('split:13')).toBe('lt100');
  });
});
