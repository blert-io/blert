import { ResolvingMetadata } from 'next';

import {
  ChallengeQuery,
  aggregateChallenges,
  findChallenges,
} from '@/actions/challenge';
import { parseChallengeQuery } from '@/api/v1/challenges/query';
import { basicMetadata } from '@/utils/metadata';
import { NextSearchParams } from '@/utils/url';

import { contextFromUrlParams } from './context';
import Search from './search';

import styles from './style.module.scss';

export default async function SearchPage({
  searchParams,
}: {
  searchParams: NextSearchParams;
}) {
  const initialContext = contextFromUrlParams(searchParams);
  let initialQuery: ChallengeQuery = { sort: ['-startTime'] };

  try {
    const query = parseChallengeQuery(searchParams);
    if (query !== null) {
      initialQuery = { ...initialQuery, ...query };
    }
  } catch (e) {
    // Ignore invalid queries.
  }

  const baseQuery = { ...initialQuery };
  baseQuery.sort = undefined;
  baseQuery.customConditions = undefined;

  const [[initialChallenges, initialRemaining], initialStats] =
    await Promise.all([
      findChallenges(25, initialQuery, { count: true }),
      aggregateChallenges(baseQuery, { '*': 'count' }).then((result) =>
        result !== null
          ? {
              count: result['*'].count,
            }
          : { count: 0 },
      ),
    ]);

  return (
    <div className={styles.searchPage}>
      <h1>Challenge search</h1>
      <Search
        initialContext={initialContext}
        initialChallenges={initialChallenges}
        initialRemaining={initialRemaining ?? initialStats.count}
        initialStats={initialStats}
      />
    </div>
  );
}

export async function generateMetadata(_props: {}, parent: ResolvingMetadata) {
  return basicMetadata(await parent, {
    title: 'Search',
    description:
      'Find recorded challenges on Blert, Old School RuneScape’s premier PvM tracker.',
  });
}
