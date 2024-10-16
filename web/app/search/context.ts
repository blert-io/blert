import { ChallengeStatus, ChallengeType } from '@blert/common';

import { SortQuery, SortableFields } from '@/actions/challenge';
import { UrlParams } from '@/utils/url';

export type SearchFilters = {
  type: ChallengeType[];
  scale: number[];
  status: ChallengeStatus[];
};

export type SearchContext = {
  filters: SearchFilters;
  sort: Array<SortQuery<SortableFields>>;
};

/**
 * Takes a set of challenge filters and converts them into an objec that can be
 * serialized into a URL query string.
 * @param filters Filters to convert.
 * @returns The URL parameters.
 */
export function filtersToUrlParams(filters: SearchFilters): UrlParams {
  const params: UrlParams = {
    type: filters.type,
    scale: filters.scale,
    status: filters.status,
  };

  return params;
}
