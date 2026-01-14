import { ResolvingMetadata } from 'next';

import {
  SessionQuery,
  aggregateSessions,
  loadSessions,
} from '@/actions/challenge';
import { basicMetadata } from '@/utils/metadata';
import { NextSearchParams } from '@/utils/url';

import { parseSessionQuery } from '../../api/v1/sessions/query';
import { contextFromUrlParams } from './context';
import SessionSearch from './session-search';

const INITIAL_RESULTS = 20;

export default async function SessionSearchPage({
  searchParams,
}: {
  searchParams: Promise<NextSearchParams>;
}) {
  const params = await searchParams;

  const initialContext = contextFromUrlParams(params);
  let initialQuery: SessionQuery = {};

  try {
    const query = parseSessionQuery(params);
    if (query !== null) {
      initialQuery = { ...initialQuery, ...query };
    }
  } catch {
    // Ignore invalid queries.
  }

  const baseQuery: SessionQuery = {
    ...initialQuery,
    before: undefined,
    after: undefined,
  };

  const [initialSessions, initialStats] = await Promise.all([
    loadSessions(INITIAL_RESULTS, initialQuery),
    aggregateSessions(baseQuery, { '*': 'count' }).then((result) =>
      result !== null
        ? {
            count: result['*'].count,
          }
        : { count: 0 },
    ),
  ]);

  if (params.before !== undefined) {
    initialSessions.reverse();
  }

  let initialRemaining = 0;
  if (initialSessions.length > 0) {
    const includeStatus = baseQuery.status === undefined;
    const boundarySession = initialSessions[initialSessions.length - 1];
    const cursor = includeStatus
      ? [boundarySession.status, boundarySession.startTime.getTime()]
      : [boundarySession.startTime.getTime()];
    const remainingResult = await aggregateSessions(
      { ...baseQuery, after: cursor },
      { '*': 'count' },
    );
    initialRemaining = remainingResult?.['*']?.count ?? 0;
  }

  return (
    <SessionSearch
      initialContext={initialContext}
      initialSessions={initialSessions}
      initialRemaining={initialRemaining}
      initialStats={initialStats}
    />
  );
}

export async function generateMetadata(
  _props: Record<string, never>,
  parent: ResolvingMetadata,
) {
  return basicMetadata(await parent, {
    title: 'Session Search',
    description:
      'Search for recorded sessions on Blert. Find past raid sessions by ' +
      'party members, date, challenge type, and more.',
  });
}
