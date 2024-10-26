import { ChallengeMode, ChallengeStatus, ChallengeType } from '@blert/common';

import {
  ExtraChallengeFields,
  SortQuery,
  SortableFields,
} from '@/actions/challenge';
import { Comparator } from '@/components/tick-input';
import { UrlParam, UrlParams } from '@/utils/url';

export type SearchFilters = {
  party: string[];
  mode: ChallengeMode[];
  scale: number[];
  status: ChallengeStatus[];
  type: ChallengeType[];
  startDate: Date | null;
  endDate: Date | null;
  splits: Record<string, [Comparator, number]>;
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
    startTime = `<${filters.endDate.getTime()}`;
  }

  const params: UrlParams = {
    party: filters.party,
    scale: filters.scale,
    status: filters.status,
    mode: modes,
    type: filters.type,
    startTime,
    options,
  };

  Object.entries(filters.splits).forEach(([split, [comparator, value]]) => {
    let cmp;
    switch (comparator) {
      case Comparator.EQUAL:
        cmp = 'eq';
        break;
      case Comparator.LESS_THAN:
        cmp = 'lt';
        break;
      case Comparator.GREATER_THAN:
        cmp = 'gt';
        break;
    }
    params[`split:${split}`] = `${cmp}${value}`;
  });

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
