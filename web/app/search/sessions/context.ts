import { SessionStatus } from '@blert/common';

import { NextSearchParams, UrlParams } from '@/utils/url';

import {
  SharedFilters,
  applySharedFilterParam,
  countSharedFilters,
  emptySharedFilters,
  numericList,
  sharedFiltersToUrlParams,
} from '../shared-filters';

export type SessionSearchFilters = SharedFilters & {
  status: SessionStatus[];
  minChallengeCount: number | null;
  maxChallengeCount: number | null;
  minDurationMinutes: number | null;
  maxDurationMinutes: number | null;
};

export type SessionSearchContext = {
  filters: SessionSearchFilters;
  pagination: {
    before?: string;
    after?: string;
  };
};

export function emptyFilters(): SessionSearchFilters {
  return {
    ...emptySharedFilters(),
    status: [],
    minChallengeCount: null,
    maxChallengeCount: null,
    minDurationMinutes: null,
    maxDurationMinutes: null,
  };
}

/**
 * Whether every filter is at its default value.
 */
export function isDefaultSessionFilters(
  filters: SessionSearchFilters,
): boolean {
  return countActiveFilters(filters) === 0;
}

export function resetSessionFilters(
  prev: SessionSearchContext,
): SessionSearchContext {
  return {
    ...prev,
    filters: emptyFilters(),
    pagination: {},
  };
}

type RangeFormatOptions = {
  scale?: number;
  upperBoundStep?: number;
};

function rangeToUrlParam(
  min: number | null,
  max: number | null,
  { scale = 1, upperBoundStep = 1 }: RangeFormatOptions = {},
): string | undefined {
  if (min !== null && max !== null) {
    return `${min * scale}..${max * scale + upperBoundStep}`;
  } else if (min !== null) {
    return `ge${min * scale}`;
  } else if (max !== null) {
    return `le${max * scale}`;
  }
  return undefined;
}

function urlParamToRange(
  value: string,
  { scale = 1, upperBoundStep = 1 }: RangeFormatOptions = {},
): { min: number | null; max: number | null } {
  if (value.startsWith('>=') || value.startsWith('ge')) {
    return { min: Math.ceil(parseInt(value.slice(2)) / scale), max: null };
  } else if (value.startsWith('<=') || value.startsWith('le')) {
    return { min: null, max: Math.floor(parseInt(value.slice(2)) / scale) };
  } else if (value.includes('..')) {
    const [lo, hi] = value.split('..').map((n) => parseInt(n));
    return {
      min: isNaN(lo) ? null : Math.ceil(lo / scale),
      max: isNaN(hi) ? null : Math.floor((hi - upperBoundStep) / scale),
    };
  }
  return { min: null, max: null };
}

/**
 * Converts session search filters into an object that can be serialized into a
 * URL query string.
 */
export function filtersToUrlParams(filters: SessionSearchFilters): UrlParams {
  return {
    ...sharedFiltersToUrlParams(filters),
    status: filters.status,
    challengeCount: rangeToUrlParam(
      filters.minChallengeCount,
      filters.maxChallengeCount,
    ),
    duration: rangeToUrlParam(
      filters.minDurationMinutes,
      filters.maxDurationMinutes,
      { scale: 60, upperBoundStep: 1 },
    ),
  };
}

/**
 * Parses URL search params into a SessionSearchContext.
 */
export function contextFromUrlParams(
  params: NextSearchParams,
): SessionSearchContext {
  const context: SessionSearchContext = {
    filters: emptyFilters(),
    pagination: {},
  };

  for (const [key, v] of Object.entries(params)) {
    const value = v as string;

    if (applySharedFilterParam(context.filters, key, value)) {
      continue;
    }

    switch (key) {
      case 'status':
        context.filters.status = numericList<SessionStatus>(value);
        break;

      case 'challengeCount': {
        const cc = urlParamToRange(value);
        context.filters.minChallengeCount = cc.min;
        context.filters.maxChallengeCount = cc.max;
        break;
      }

      case 'duration': {
        const dur = urlParamToRange(value, { scale: 60, upperBoundStep: 1 });
        context.filters.minDurationMinutes = dur.min;
        context.filters.maxDurationMinutes = dur.max;
        break;
      }

      case 'before':
        context.pagination.before = value;
        break;

      case 'after':
        context.pagination.after = value;
        break;
    }
  }

  return context;
}

export function countActiveFilters(filters: SessionSearchFilters): number {
  let count = countSharedFilters(filters);
  if (filters.status.length > 0) {
    count++;
  }
  if (
    filters.minChallengeCount !== null ||
    filters.maxChallengeCount !== null
  ) {
    count++;
  }
  if (
    filters.minDurationMinutes !== null ||
    filters.maxDurationMinutes !== null
  ) {
    count++;
  }
  return count;
}
