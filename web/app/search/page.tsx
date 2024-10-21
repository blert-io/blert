import { ChallengeStatus } from '@blert/common';
import { ResolvingMetadata } from 'next';

import {
  ChallengeQuery,
  aggregateChallenges,
  findChallenges,
} from '@/actions/challenge';
import { basicMetadata } from '@/utils/metadata';

import { SearchContext, SearchFilters } from './context';
import Search from './search';

import styles from './style.module.scss';

export default async function SearchPage() {
  const initialFilters: SearchFilters = {
    party: [],
    scale: [],
    status: [
      ChallengeStatus.COMPLETED,
      ChallengeStatus.RESET,
      ChallengeStatus.WIPED,
    ],
    type: [],
  };
  const initialContext: SearchContext = {
    filters: initialFilters,
    sort: ['-startTime'],
    extraFields: {},
  };

  const query: ChallengeQuery = {
    sort: initialContext.sort,
    status: ['in', initialFilters.status],
  };

  const [[initialChallenges], initialStats] = await Promise.all([
    findChallenges(25, query),
    aggregateChallenges(query, { '*': 'count' }).then((result) =>
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
