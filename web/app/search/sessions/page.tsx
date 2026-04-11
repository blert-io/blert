import { ResolvingMetadata } from 'next';

import { SessionQuery, loadSessionsPage } from '@/actions/challenge';
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

  const {
    sessions: initialSessions,
    total,
    remaining: initialRemaining,
  } = await loadSessionsPage(INITIAL_RESULTS, initialQuery);

  if (params.before !== undefined) {
    initialSessions.reverse();
  }

  return (
    <SessionSearch
      initialContext={initialContext}
      initialSessions={initialSessions}
      initialRemaining={initialRemaining}
      initialStats={{ count: total }}
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
