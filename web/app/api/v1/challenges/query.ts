import { ChallengeMode, SplitType } from '@blert/common';

import { ChallengeQuery, SortQuery, SortableFields } from '@/actions/challenge';
import { Condition, Operator, parseQuery } from '@/actions/query';
import {
  dateComparatorParam,
  expectSingle,
  numericComparatorParam,
  numericComparatorValue,
} from '@/api/query';
import { NextSearchParams } from '@/utils/url';

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
    if (key.startsWith('split:')) {
      if (value === undefined || Array.isArray(value)) {
        return null;
      }

      const parts = key.split(':');
      if (parts.length !== 2) {
        return null;
      }

      const split = parseInt(parts[1]) as SplitType;
      if (Number.isNaN(split)) {
        return null;
      }

      try {
        query.splits!.set(split, numericComparatorValue(value));
      } catch (e) {
        return null;
      }
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
  } catch (e) {
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
    const op = secondarySort[0] === '+' ? '>' : '<';
    const val = Number.parseInt(secondaryValue);
    if (Number.isNaN(val)) {
      return null;
    }
    secondaryCondition = [secondaryField, op, val];
  }

  let operator: Operator = primarySort[0] === '+' ? '>' : '<';
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
      secondary = [[sortField, '==', value], '&&', secondaryCondition!];
    }

    if (cond === null) {
      cond = secondary;
    } else {
      cond = [cond, '||', secondary];
    }
  }

  return cond;
}
