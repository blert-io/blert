import { ChallengeStatus, Stage } from '@blert/common';

import {
  ExtraChallengeFields,
  SortQuery,
  SortableFields,
} from '@/actions/challenge';
import { Comparator } from '@/components/tick-input';
import { NextSearchParams, UrlParam, UrlParams } from '@/utils/url';

import {
  SharedFilters,
  applySharedFilterParam,
  countSharedFilters,
  emptySharedFilters,
  numericList,
  sharedFiltersToUrlParams,
} from '../shared-filters';

function serializeComparator(comparator: Comparator): string {
  switch (comparator) {
    case Comparator.EQUAL:
      return 'eq';
    case Comparator.LESS_THAN:
      return 'lt';
    case Comparator.GREATER_THAN:
      return 'gt';
    case Comparator.LESS_THAN_OR_EQUAL:
      return 'le';
    case Comparator.GREATER_THAN_OR_EQUAL:
      return 'ge';
  }
}

function parseComparatorParam<T extends number>(
  value: string,
): [Comparator, T] | null {
  let comparator: Comparator;

  if (value.startsWith('eq')) {
    comparator = Comparator.EQUAL;
  } else if (value.startsWith('le')) {
    comparator = Comparator.LESS_THAN_OR_EQUAL;
  } else if (value.startsWith('ge')) {
    comparator = Comparator.GREATER_THAN_OR_EQUAL;
  } else if (value.startsWith('lt')) {
    comparator = Comparator.LESS_THAN;
  } else if (value.startsWith('gt')) {
    comparator = Comparator.GREATER_THAN;
  } else {
    return null;
  }

  const num = parseInt(value.slice(2));
  if (isNaN(num)) {
    return null;
  }

  return [comparator, num as T];
}

export type TobFilters = {
  bloatDowns: Map<number, [Comparator, number]>;
  bloatDownCount: [Comparator, number] | null;
  nylocasPreCapStalls: [Comparator, number] | null;
  nylocasPostCapStalls: [Comparator, number] | null;
  verzikRedsCount: [Comparator, number] | null;
};

function parseTobParam(tob: TobFilters, key: string, value: string): void {
  if (key.startsWith('bloatDown:')) {
    const down = parseInt(key.slice(10));
    if (!isNaN(down)) {
      const parsed = parseComparatorParam(value);
      if (parsed !== null) {
        tob.bloatDowns.set(down, parsed);
      }
    }
    return;
  }

  const scalarFields: Exclude<keyof TobFilters, 'bloatDowns'>[] = [
    'bloatDownCount',
    'nylocasPreCapStalls',
    'nylocasPostCapStalls',
    'verzikRedsCount',
  ];
  const field = scalarFields.find((f) => f === key);
  if (field !== undefined) {
    const parsed = parseComparatorParam(value);
    if (parsed !== null) {
      tob[field] = parsed;
    }
  }
}

export function emptyTobFilters(): TobFilters {
  return {
    bloatDowns: new Map(),
    bloatDownCount: null,
    nylocasPreCapStalls: null,
    nylocasPostCapStalls: null,
    verzikRedsCount: null,
  };
}

export function hasTobFilters(tob: TobFilters): boolean {
  return (
    tob.bloatDowns.size > 0 ||
    tob.bloatDownCount !== null ||
    tob.nylocasPreCapStalls !== null ||
    tob.nylocasPostCapStalls !== null ||
    tob.verzikRedsCount !== null
  );
}

function countTobFilters(tob: TobFilters): number {
  let count = tob.bloatDowns.size;
  if (tob.bloatDownCount !== null) {
    count++;
  }
  if (tob.nylocasPreCapStalls !== null) {
    count++;
  }
  if (tob.nylocasPostCapStalls !== null) {
    count++;
  }
  if (tob.verzikRedsCount !== null) {
    count++;
  }
  return count;
}

export function countActiveFilters(filters: SearchFilters): number {
  let count = countSharedFilters(filters);
  if (filters.status.length > 0) {
    count++;
  }
  if (filters.stage !== null) {
    count++;
  }
  count += filters.splits.size;
  count += countTobFilters(filters.tob);
  if (filters.accurateSplits) {
    count++;
  }
  if (filters.fullRecordings) {
    count++;
  }
  return count;
}

export type SearchFilters = SharedFilters & {
  status: ChallengeStatus[];
  stage: [Comparator, Stage] | null;
  splits: Map<number, [Comparator, number]>;
  tob: TobFilters;
  accurateSplits: boolean;
  fullRecordings: boolean;
};

export function defaultSearchFilters(): SearchFilters {
  return {
    ...emptySharedFilters(),
    status: [],
    stage: null,
    splits: new Map(),
    tob: emptyTobFilters(),
    accurateSplits: true,
    fullRecordings: false,
  };
}

/**
 * Whether every filter is at its default value. At defaults the only active
 * contributor to {@link countActiveFilters} is `accurateSplits=true`.
 */
export function isDefaultSearchFilters(filters: SearchFilters): boolean {
  return filters.accurateSplits && countActiveFilters(filters) === 1;
}

export type SearchContext = {
  filters: SearchFilters;
  sort: SortQuery<SortableFields>[];
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

  if (!filters.accurateSplits) {
    options.push('noAccurateSplits');
  }
  if (filters.fullRecordings) {
    options.push('fullRecordings');
  }

  const params: UrlParams = {
    ...sharedFiltersToUrlParams(filters),
    status: filters.status,
    options,
  };

  if (filters.stage !== null) {
    const [comparator, value] = filters.stage;
    params.stage = `${serializeComparator(comparator)}${value}`;
  }

  for (const [split, [comparator, value]] of filters.splits) {
    params[`split:${split}`] = `${serializeComparator(comparator)}${value}`;
  }

  for (const [down, [comparator, value]] of filters.tob.bloatDowns) {
    params[`tob.bloatDown:${down}`] =
      `${serializeComparator(comparator)}${value}`;
  }

  const tobScalarFields: Exclude<keyof TobFilters, 'bloatDowns'>[] = [
    'bloatDownCount',
    'nylocasPreCapStalls',
    'nylocasPostCapStalls',
    'verzikRedsCount',
  ];
  for (const field of tobScalarFields) {
    const v = filters.tob[field];
    if (v !== null) {
      const [comparator, value] = v;
      params[`tob.${field}`] = `${serializeComparator(comparator)}${value}`;
    }
  }

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
  if (extraFields.stats) {
    param.push('stats');
  }

  return param;
}

export function contextFromUrlParams(params: NextSearchParams): SearchContext {
  const context: SearchContext = {
    filters: defaultSearchFilters(),
    sort: [],
    extraFields: {},
    pagination: {},
  };

  for (const [key, v] of Object.entries(params)) {
    const value = v as string;

    if (applySharedFilterParam(context.filters, key, value)) {
      continue;
    }

    switch (key) {
      case 'status':
        context.filters.status = numericList<ChallengeStatus>(value);
        break;

      case 'stage': {
        const parsed = parseComparatorParam<Stage>(value);
        if (parsed !== null) {
          context.filters.stage = parsed;
        }
        break;
      }

      case 'options': {
        const options = value.split(',');
        for (const option of options) {
          switch (option) {
            case 'noAccurateSplits':
              context.filters.accurateSplits = false;
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
          const split = parseInt(key.slice(6));
          if (!isNaN(split)) {
            const parsed = parseComparatorParam(value);
            if (parsed !== null) {
              context.filters.splits.set(split, parsed);
            }
          }
        } else if (key.startsWith('tob.')) {
          parseTobParam(context.filters.tob, key.slice(4), value);
        }
        break;
    }
  }

  if (context.sort.length === 0) {
    context.sort.push('-startTime');
  }

  return context;
}
