import { ChallengeMode, ChallengeStatus, ChallengeType } from '@blert/common';

import {
  ExtraChallengeFields,
  SortQuery,
  SortableFields,
} from '@/actions/challenge';
import { Comparator } from '@/components/tick-input';
import { NextSearchParams, UrlParam, UrlParams } from '@/utils/url';

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
  fullRecordings: boolean;
};

export type SearchContext = {
  filters: SearchFilters;
  sort: Array<SortQuery<SortableFields>>;
  extraFields: ExtraChallengeFields;
  pagination: {
    before?: string;
    after?: string;
  };
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
  if (filters.fullRecordings) {
    options.push('fullRecordings');
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

function numericList<T = number>(value: string): T[] {
  return value
    .split(',')
    .map((n) => parseInt(n))
    .filter((n) => !isNaN(n)) as T[];
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

export function contextFromUrlParams(params: NextSearchParams): SearchContext {
  const context: SearchContext = {
    filters: {
      party: [],
      mode: [],
      scale: [],
      status: [],
      type: [],
      startDate: null,
      endDate: null,
      splits: {},
      accurateSplits: false,
      fullRecordings: false,
    },
    sort: [],
    extraFields: {},
    pagination: {},
  };

  for (const [key, v] of Object.entries(params)) {
    const value = v as string;

    switch (key) {
      case 'party':
        context.filters.party = value.split(',');
        break;

      case 'mode':
        context.filters.mode = numericList<ChallengeMode>(value);
        break;

      case 'scale':
        context.filters.scale = numericList(value);
        break;

      case 'status':
        context.filters.status = numericList<ChallengeStatus>(value);
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

      case 'options': {
        const options = value.split(',');
        for (const option of options) {
          switch (option) {
            case 'accurateSplits':
              context.filters.accurateSplits = true;
              break;
            case 'fullRecordings':
              context.filters.fullRecordings = true;
              break;
          }
        }
        break;
      }

      case 'sort': {
        const sorts = value.split(',');
        for (const sort of sorts) {
          context.sort.push(sort as SortQuery<SortableFields>);
        }
        break;
      }

      case 'before':
        context.pagination.before = value;
        break;

      case 'after':
        context.pagination.after = value;
        break;

      default:
        if (key.startsWith('split:')) {
          const split = key.slice(6);
          let comparator: Comparator;
          let num: number;
          if (value.startsWith('eq')) {
            comparator = Comparator.EQUAL;
          } else if (value.startsWith('lt')) {
            comparator = Comparator.LESS_THAN;
          } else if (value.startsWith('gt')) {
            comparator = Comparator.GREATER_THAN;
          } else {
            continue;
          }
          num = parseInt(value.slice(2));
          if (!isNaN(num)) {
            context.filters.splits[split] = [comparator, num];
          }
        }
        break;
    }
  }

  if (context.sort.length === 0) {
    context.sort.push('-startTime');
  }

  return context;
}
