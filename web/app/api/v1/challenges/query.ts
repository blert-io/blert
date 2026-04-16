import { ChallengeMode, SplitType } from '@blert/common';

import { ChallengeQuery, SortQuery, SortableFields } from '@/actions/challenge';
import { Comparator, Condition, Operator, parseQuery } from '@/actions/query';
import {
  dateComparatorParam,
  expectSingle,
  numericComparatorParam,
  numericComparatorValue,
} from '@/api/query';
import { NextSearchParams } from '@/utils/url';

type NamespacedParamHandler = {
  validateKey?: (id: number) => boolean;
  apply: (
    query: ChallengeQuery,
    id: number,
    comparator: Comparator<number>,
  ) => void;
};

const namespacedParams: Record<string, NamespacedParamHandler> = {
  split: {
    apply: (query, id, comparator) => {
      (query.splits ??= new Map()).set(id as SplitType, comparator);
    },
  },
  'tob.bloatDown': {
    validateKey: (id) => id >= 1,
    apply: (query, id, comparator) => {
      ((query.tob ??= {}).bloatDowns ??= new Map()).set(id, comparator);
    },
  },
};

export function parseChallengeQueryParams(
  searchParams: URLSearchParams,
): ChallengeQuery | null {
  return parseChallengeQuery(Object.fromEntries(searchParams));
}

export function parseChallengeQuery(
  searchParams: NextSearchParams,
): ChallengeQuery | null {
  const party = expectSingle(searchParams, 'party')?.split(',') ?? undefined;
  const mode = expectSingle(searchParams, 'mode')
    ?.split(',')
    .map((m) => parseInt(m))
    ?.filter((m) => !isNaN(m)) as ChallengeMode[] | undefined;

  const query: ChallengeQuery = {
    mode,
    party,
    splits: new Map(),
    customConditions: [],
  };

  const before = expectSingle(searchParams, 'before');
  const after = expectSingle(searchParams, 'after');
  if (before !== undefined && after !== undefined) {
    return null;
  }

  const reverseSorts = before !== undefined;

  const sort = expectSingle(searchParams, 'sort');
  let sortFields: SortQuery<SortableFields>[] = [];
  if (sort !== undefined) {
    query.sort = [];

    const fields = sort.split(',');
    if (fields.length === 0 || fields.length > 2) {
      return null;
    }

    for (const sort of fields) {
      const sortOp = sort[0];
      if (sortOp !== '-' && sortOp !== '+') {
        return null;
      }

      const sortField = sort.slice(1) as SortableFields;
      const sortDirection = reverseSorts
        ? sortOp === '+'
          ? '-'
          : '+'
        : sortOp;
      const options = reverseSorts ? 'nf' : 'nl';
      query.sort.push(
        `${sortDirection}${sortField}#${options}` as SortQuery<SortableFields>,
      );
    }

    sortFields = query.sort;
  }

  if (before !== undefined) {
    const condition = paginationCondition(sortFields, before.split(','), true);
    if (condition === null) {
      return null;
    }
    query.customConditions!.push(condition);
  } else if (after !== undefined) {
    const condition = paginationCondition(sortFields, after.split(','), false);
    if (condition === null) {
      return null;
    }
    query.customConditions!.push(condition);
  }

  for (const [key, value] of Object.entries(searchParams)) {
    const colonIndex = key.indexOf(':');
    if (colonIndex === -1) {
      continue;
    }

    const handler = namespacedParams[key.slice(0, colonIndex)];
    if (handler === undefined) {
      continue;
    }

    if (value === undefined || Array.isArray(value)) {
      return null;
    }

    const id = parseInt(key.slice(colonIndex + 1));
    if (Number.isNaN(id)) {
      return null;
    }

    if (handler.validateKey !== undefined && !handler.validateKey(id)) {
      return null;
    }

    try {
      handler.apply(query, id, numericComparatorValue(value));
    } catch {
      return null;
    }
  }

  try {
    query.type = numericComparatorParam(searchParams, 'type');
    query.scale = numericComparatorParam(searchParams, 'scale');
    query.status = numericComparatorParam(searchParams, 'status');
    query.startTime = dateComparatorParam(searchParams, 'startTime');
    query.challengeTicks = numericComparatorParam(
      searchParams,
      'challengeTicks',
    );
    query.stage = numericComparatorParam(searchParams, 'stage');

    const tobScalarParams = [
      'bloatDownCount',
      'nylocasPreCapStalls',
      'nylocasPostCapStalls',
      'verzikRedsCount',
    ] as const;
    for (const field of tobScalarParams) {
      const value = numericComparatorParam(searchParams, `tob.${field}`);
      if (value !== undefined) {
        (query.tob ??= {})[field] = value;
      }
    }

    const mokhaiotlScalarParams = ['maxCompletedDelve'] as const;
    for (const field of mokhaiotlScalarParams) {
      const value = numericComparatorParam(searchParams, `mok.${field}`);
      if (value !== undefined) {
        (query.mokhaiotl ??= {})[field] = value;
      }
    }
  } catch {
    return null;
  }

  const customQuery = expectSingle(searchParams, 'q');
  if (customQuery !== undefined) {
    const customConditions = parseQuery(atob(customQuery));
    if (customConditions === null) {
      return null;
    }
    query.customConditions!.push(customConditions);
  }

  return query;
}

function paginationCondition(
  sorts: SortQuery<SortableFields>[],
  values: string[],
  reverse: boolean,
): Condition | null {
  if (sorts.length !== values.length) {
    return null;
  }

  const [primarySort, secondarySort] = sorts;
  const [primaryValue, secondaryValue] = values;

  let secondaryCondition: Condition | null = null;
  if (secondarySort !== undefined) {
    const secondaryField = secondarySort
      .slice(1)
      .split('#')[0] as SortableFields;
    const op = secondarySort.startsWith('+') ? '>' : '<';
    const val = Number.parseInt(secondaryValue);
    if (Number.isNaN(val)) {
      return null;
    }
    secondaryCondition = [secondaryField, op, val];
  }

  const operator: Operator = primarySort.startsWith('+') ? '>' : '<';
  const sortField = primarySort.slice(1).split('#')[0] as SortableFields;

  const value = primaryValue === 'null' ? null : Number.parseInt(primaryValue);
  if (Number.isNaN(value)) {
    return null;
  }

  let cond: Condition | null = null;
  if (value !== null) {
    cond = [sortField, operator, value];
    if (!reverse) {
      cond = [cond, '||', [sortField, 'is', null]];
    }
  }

  if (secondaryCondition !== null) {
    let secondary: Condition;
    if (reverse && value === null) {
      // When paging backwards, null values will be first, followed by
      // non-null values.
      const isNotNull: Condition = [sortField, 'isnot', null];
      const isNullBefore: Condition = [
        [sortField, 'is', null],
        '&&',
        secondaryCondition,
      ];
      secondary = [isNotNull, '||', isNullBefore];
    } else {
      secondary = [[sortField, '==', value], '&&', secondaryCondition];
    }

    if (cond === null) {
      cond = secondary;
    } else {
      cond = [cond, '||', secondary];
    }
  }

  return cond;
}
