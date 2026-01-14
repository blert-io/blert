import { ChallengeMode, ChallengeType, SessionStatus } from '@blert/common';

import { NextSearchParams, UrlParams } from '@/utils/url';

export type SessionSearchFilters = {
  type: ChallengeType[];
  mode: ChallengeMode[];
  scale: number[];
  status: SessionStatus[];
  party: string[];
  startDate: Date | null;
  endDate: Date | null;
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
    type: [],
    mode: [],
    scale: [],
    status: [],
    party: [],
    startDate: null,
    endDate: null,
  };
}

export function emptyContext(): SessionSearchContext {
  return {
    filters: emptyFilters(),
    pagination: {},
  };
}

/**
 * Converts session search filters into an object that can be serialized into a
 * URL query string.
 */
export function filtersToUrlParams(filters: SessionSearchFilters): UrlParams {
  let startTime;
  if (filters.startDate !== null && filters.endDate !== null) {
    const endDate = new Date(filters.endDate);
    endDate.setDate(endDate.getDate() + 1);
    startTime = `${filters.startDate.getTime()}..${endDate.getTime()}`;
  } else if (filters.startDate !== null) {
    startTime = `>=${filters.startDate.getTime()}`;
  } else if (filters.endDate !== null) {
    const endDate = new Date(filters.endDate);
    endDate.setDate(endDate.getDate() + 1);
    startTime = `<${endDate.getTime()}`;
  }

  return {
    party: filters.party,
    scale: filters.scale,
    status: filters.status,
    mode: filters.mode,
    type: filters.type,
    startTime,
  };
}

function numericList<T = number>(value: string): T[] {
  return value
    .split(',')
    .map((n) => parseInt(n))
    .filter((n) => !isNaN(n)) as T[];
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

    switch (key) {
      case 'party':
        context.filters.party = value.split(',').map((p) => p.trim());
        break;

      case 'mode':
        context.filters.mode = numericList<ChallengeMode>(value);
        break;

      case 'scale':
        context.filters.scale = numericList(value);
        break;

      case 'status':
        context.filters.status = numericList<SessionStatus>(value);
        break;

      case 'type':
        context.filters.type = numericList<ChallengeType>(value);
        break;

      case 'startTime':
        if (value.startsWith('>=')) {
          context.filters.startDate = new Date(parseInt(value.slice(2)));
        } else if (value.startsWith('<')) {
          context.filters.endDate = new Date(parseInt(value.slice(1)));
        } else {
          const [start, end] = value.split('..').map((time) => parseInt(time));
          context.filters.startDate = new Date(start);
          context.filters.endDate = new Date(end);
        }
        break;

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
