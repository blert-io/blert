import { SplitType } from '@blert/common';
import { ResolvingMetadata } from 'next';

import {
  ChallengeQuery,
  aggregateChallenges,
  findChallenges,
} from '@/actions/challenge';
import { Comparator } from '@/actions/query';
import { parseChallengeQuery } from '@/api/v1/challenges/query';
import { basicMetadata } from '@/utils/metadata';
import { NextSearchParams } from '@/utils/url';

import { contextFromUrlParams } from './context';
import Search from './search';

const INITIAL_RESULTS = 25;

function withImplicitSplitSortFilters(
  query: ChallengeQuery,
  accurateSplits: boolean,
): ChallengeQuery {
  if (!accurateSplits || query.sort === undefined) {
    return query;
  }

  const sorts = Array.isArray(query.sort) ? query.sort : [query.sort];
  const splits =
    query.splits !== undefined
      ? new Map(query.splits)
      : new Map<SplitType, Comparator<number>>();
  let changed = false;

  for (const sort of sorts) {
    const sortField = sort.slice(1).split('#')[0];
    if (!sortField.startsWith('splits:')) {
      continue;
    }

    const split = Number.parseInt(sortField.slice(7)) as SplitType;
    if (Number.isNaN(split) || splits.has(split)) {
      continue;
    }

    splits.set(split, ['>=', 0]);
    changed = true;
  }

  if (!changed) {
    return query;
  }

  return {
    ...query,
    splits,
  };
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<NextSearchParams>;
}) {
  const params = await searchParams;

  const initialContext = contextFromUrlParams(params);
  let initialQuery: ChallengeQuery = { sort: ['-startTime'] };

  try {
    const query = parseChallengeQuery(params);
    if (query !== null) {
      initialQuery = { ...initialQuery, ...query };
    }
  } catch {
    // Ignore invalid queries.
  }

  const queryOptions = {
    accurateSplits: initialContext.filters.accurateSplits,
    fullRecordings: initialContext.filters.fullRecordings,
  };
  initialQuery = withImplicitSplitSortFilters(
    initialQuery,
    queryOptions.accurateSplits,
  );

  const baseQuery = { ...initialQuery };
  baseQuery.sort = undefined;
  baseQuery.customConditions = undefined;

  const [initialChallenges, initialStats] = await Promise.all([
    findChallenges(INITIAL_RESULTS, initialQuery, queryOptions).then(
      ([challenges]) => {
        if (params.before !== undefined) {
          challenges.reverse();
        }
        return challenges;
      },
    ),
    aggregateChallenges(baseQuery, { '*': 'count' }, queryOptions).then(
      (result) =>
        result !== null
          ? {
              count: result['*'].count,
            }
          : { count: 0 },
    ),
  ]);

  return (
    <Search
      initialContext={initialContext}
      initialChallenges={initialChallenges}
      initialStats={initialStats}
    />
  );
}

export async function generateMetadata(
  _props: Record<string, never>,
  parent: ResolvingMetadata,
) {
  return basicMetadata(await parent, {
    title: 'OSRS Challenge Search',
    description:
      'Find recorded raids and challenges on Blert, Old School RuneScape’s ' +
      'premier PvM tracker. Search by name, date, or other criteria.',
  });
}
