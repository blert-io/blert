import { ChallengeStatus, ChallengeType } from '@blert/common';

import { SortQuery, SortableFields } from '@/actions/challenge';
import { UrlParams } from '@/utils/url';

export type SearchFilters = {
  party: string[];
  scale: number[];
  status: ChallengeStatus[];
  type: ChallengeType[];
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
    party: filters.party,
    scale: filters.scale,
    status: filters.status,
    type: filters.type,
  };

  return params;
}
