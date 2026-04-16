import { ChallengeMode, ChallengeType } from '@blert/common';

import { UrlParams } from '@/utils/url';

export type SharedFilters = {
  party: string[];
  mode: ChallengeMode[];
  scale: number[];
  type: ChallengeType[];
  startDate: Date | null;
  endDate: Date | null;
};

export const SHARED_FILTER_PARAMS = [
  'party',
  'mode',
  'scale',
  'type',
  'startTime',
] as const;

export function emptySharedFilters(): SharedFilters {
  return {
    party: [],
    mode: [],
    scale: [],
    type: [],
    startDate: null,
    endDate: null,
  };
}

export function numericList<T = number>(value: string): T[] {
  return value
    .split(',')
    .map((n) => parseInt(n))
    .filter((n) => !isNaN(n)) as T[];
}

/** Count the number of non-empty shared filter categories. */
export function countSharedFilters(filters: SharedFilters): number {
  let count = 0;
  if (filters.party.length > 0) {
    count++;
  }
  if (filters.type.length > 0 || filters.mode.length > 0) {
    count++;
  }
  if (filters.scale.length > 0) {
    count++;
  }
  if (filters.startDate !== null || filters.endDate !== null) {
    count++;
  }
  return count;
}

export function sharedFiltersToUrlParams(filters: SharedFilters): UrlParams {
  let startTime: string | undefined;
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
    mode: filters.mode,
    type: filters.type,
    startTime,
  };
}

export function applySharedFilterParam(
  filters: SharedFilters,
  key: string,
  value: string,
): boolean {
  switch (key) {
    case 'party':
      filters.party = value.split(',').map((p) => p.trim());
      return true;
    case 'mode':
      filters.mode = numericList<ChallengeMode>(value);
      return true;
    case 'scale':
      filters.scale = numericList(value);
      return true;
    case 'type':
      filters.type = numericList<ChallengeType>(value);
      return true;
    case 'startTime':
      if (value.startsWith('>=')) {
        filters.startDate = new Date(parseInt(value.slice(2)));
      } else if (value.startsWith('<')) {
        filters.endDate = new Date(parseInt(value.slice(1)));
      } else {
        const [start, end] = value.split('..').map((time) => parseInt(time));
        filters.startDate = new Date(start);
        filters.endDate = new Date(end);
      }
      return true;
  }
  return false;
}

export function buildEntityHref(
  targetPath: string,
  currentParams: URLSearchParams | null,
): string {
  if (currentParams === null) {
    return targetPath;
  }
  const sharedParams = new URLSearchParams();
  for (const key of SHARED_FILTER_PARAMS) {
    const values = currentParams.getAll(key);
    for (const v of values) {
      sharedParams.append(key, v);
    }
  }
  const queryString = sharedParams.toString();
  return queryString ? `${targetPath}?${queryString}` : targetPath;
}
