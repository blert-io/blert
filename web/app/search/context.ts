import { ChallengeMode, ChallengeStatus, ChallengeType } from '@blert/common';

import {
  ExtraChallengeFields,
  SortQuery,
  SortableFields,
} from '@/actions/challenge';
import { UrlParam, UrlParams } from '@/utils/url';

export type SearchFilters = {
  party: string[];
  mode: ChallengeMode[];
  scale: number[];
  status: ChallengeStatus[];
  type: ChallengeType[];
  accurateSplits: boolean;
};

export type SearchContext = {
  filters: SearchFilters;
  sort: Array<SortQuery<SortableFields>>;
  extraFields: ExtraChallengeFields;
};

/**
 * Takes a set of challenge filters and converts them into an object that can be
 * serialized into a URL query string.
 * @param filters Filters to convert.
 * @returns The URL parameters.
 */
export function filtersToUrlParams(filters: SearchFilters): UrlParams {
  const options: string[] = [];

  if (filters.accurateSplits) {
    options.push('accurateSplits');
  }

  const modes = [...filters.mode];
  if (filters.type.includes(ChallengeType.COLOSSEUM)) {
    modes.push(ChallengeMode.NO_MODE);
  }

  const params: UrlParams = {
    party: filters.party,
    scale: filters.scale,
    status: filters.status,
    mode: modes,
    type: filters.type,
    options,
  };

  return params;
}

export function extraFieldsToUrlParam(
  extraFields: ExtraChallengeFields,
): UrlParam {
  const param: string[] = [];

  if (extraFields.splits) {
    for (const split of extraFields.splits) {
      param.push(`splits:${split}`);
    }
  }

  return param;
}
