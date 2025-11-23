import { ResolvingMetadata } from 'next';

import {
  ChallengeQuery,
  aggregateChallenges,
  findChallenges,
} from '@/actions/challenge';
import { parseChallengeQuery } from '@/api/v1/challenges/query';
import Card from '@/components/card';
import { basicMetadata } from '@/utils/metadata';
import { NextSearchParams } from '@/utils/url';

import { contextFromUrlParams } from './context';
import Search from './search';

import styles from './style.module.scss';

const INITIAL_RESULTS = 25;

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

  const baseQuery = { ...initialQuery };
  baseQuery.sort = undefined;
  baseQuery.customConditions = undefined;

  const [[initialChallenges, remaining], initialStats] = await Promise.all([
    findChallenges(INITIAL_RESULTS, initialQuery, { count: true }),
    aggregateChallenges(baseQuery, { '*': 'count' }).then((result) =>
      result !== null
        ? {
            count: result['*'].count,
          }
        : { count: 0 },
    ),
  ]);

  let initialRemaining: number;
  if (params.before !== undefined) {
    initialRemaining =
      initialStats.count - (remaining ?? initialStats.count) + INITIAL_RESULTS;
    initialChallenges.reverse();
  } else {
    initialRemaining = remaining ?? initialStats.count;
  }

  return (
    <div className={styles.searchPage}>
      <Card primary className={styles.header}>
        <h1>Challenge search</h1>
        <p>
          Search for challenges by name, date, or other criteria. You can also
          filter by status, scale, party size, and more.
        </p>
      </Card>
      <Search
        initialContext={initialContext}
        initialChallenges={initialChallenges}
        initialRemaining={initialRemaining}
        initialStats={initialStats}
      />
    </div>
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
