import { ChallengeMode, ChallengeType, SessionStatus } from '@blert/common';

import { NextSearchParams, queryString } from '@/utils/url';

import {
  SessionSearchFilters,
  contextFromUrlParams,
  countActiveFilters,
  emptyFilters,
  filtersToUrlParams,
} from '../context';

function queryToParams(qs: string): NextSearchParams {
  const params: NextSearchParams = {};
  const search = new URLSearchParams(qs);
  for (const key of Array.from(new Set(search.keys()))) {
    const values = search.getAll(key);
    params[key] = values.length > 1 ? values : values[0];
  }
  return params;
}

function roundTrip(filters: SessionSearchFilters): SessionSearchFilters {
  const url = queryString(filtersToUrlParams(filters));
  const ctx = contextFromUrlParams(queryToParams(url));
  return ctx.filters;
}

describe('sessions filter URL round-trip', () => {
  it('preserves all shared fields', () => {
    const filters: SessionSearchFilters = {
      ...emptyFilters(),
      party: ['WWWWWWWWWWQQ', 'otter pet'],
      type: [ChallengeType.COLOSSEUM],
      mode: [ChallengeMode.NO_MODE],
      scale: [1, 2],
      startDate: new Date('2026-02-01T00:00:00Z'),
    };
    const result = roundTrip(filters);
    expect(result.party).toEqual(['WWWWWWWWWWQQ', 'otter pet']);
    expect(result.type).toEqual([ChallengeType.COLOSSEUM]);
    expect(result.mode).toEqual([ChallengeMode.NO_MODE]);
    expect(result.scale).toEqual([1, 2]);
    expect(result.startDate?.getTime()).toBe(filters.startDate!.getTime());
  });

  it('preserves status', () => {
    const filters: SessionSearchFilters = {
      ...emptyFilters(),
      status: [SessionStatus.COMPLETED, SessionStatus.ACTIVE],
    };
    const result = roundTrip(filters);
    expect(result.status).toEqual([
      SessionStatus.COMPLETED,
      SessionStatus.ACTIVE,
    ]);
  });

  it('preserves challenge-count range', () => {
    const filters: SessionSearchFilters = {
      ...emptyFilters(),
      minChallengeCount: 5,
      maxChallengeCount: 20,
    };
    const result = roundTrip(filters);
    expect(result.minChallengeCount).toBe(5);
    expect(result.maxChallengeCount).toBe(20);
  });

  it('preserves a min-only challenge-count range', () => {
    const filters: SessionSearchFilters = {
      ...emptyFilters(),
      minChallengeCount: 3,
    };
    const result = roundTrip(filters);
    expect(result.minChallengeCount).toBe(3);
    expect(result.maxChallengeCount).toBeNull();
  });

  it('preserves duration range in minutes (scale=60)', () => {
    const filters: SessionSearchFilters = {
      ...emptyFilters(),
      minDurationMinutes: 30,
      maxDurationMinutes: 120,
    };
    const result = roundTrip(filters);
    expect(result.minDurationMinutes).toBe(30);
    expect(result.maxDurationMinutes).toBe(120);
  });

  it('produces an empty query string for empty filters', () => {
    expect(queryString(filtersToUrlParams(emptyFilters()))).toBe('');
  });
});

describe('countActiveFilters', () => {
  it('returns 0 for empty filters', () => {
    expect(countActiveFilters(emptyFilters())).toBe(0);
  });

  it('counts status, challenge-count range, and duration range each as one', () => {
    const filters: SessionSearchFilters = {
      ...emptyFilters(),
      status: [SessionStatus.ACTIVE],
      minChallengeCount: 5,
      minDurationMinutes: 30,
    };
    expect(countActiveFilters(filters)).toBe(3);
  });

  it('counts a range with only a max bound', () => {
    const filters: SessionSearchFilters = {
      ...emptyFilters(),
      maxChallengeCount: 10,
    };
    expect(countActiveFilters(filters)).toBe(1);
  });

  it('includes shared filter counts', () => {
    const filters: SessionSearchFilters = {
      ...emptyFilters(),
      party: ['WWWWWWWWWWQQ'],
      type: [ChallengeType.TOB],
      mode: [ChallengeMode.TOB_REGULAR],
      status: [SessionStatus.COMPLETED],
    };
    expect(countActiveFilters(filters)).toBe(3);
  });
});
