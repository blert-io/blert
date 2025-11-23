import { ChallengeStatus, ChallengeType } from '@blert/common';

import {
  aggregateChallenges,
  ChallengeQuery,
  loadPbsForPlayer,
  topPartnersForPlayer,
} from '@/actions/challenge';

import PlayerOverviewContent from './overview-content';

export default async function PlayerOverview({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const username = await params.then((p) => decodeURIComponent(p.username));

  const query: ChallengeQuery = {
    party: [username],
  };

  const oneYearAgo = new Date();
  oneYearAgo.setUTCFullYear(oneYearAgo.getUTCFullYear() - 1);
  oneYearAgo.setUTCHours(0, 0, 0, 0);

  const [
    personalBests,
    challengeStatuses,
    challengeScales,
    challengeCountsLastYear,
    topPartners,
  ] = await Promise.all([
    loadPbsForPlayer(username),
    aggregateChallenges(query, { '*': 'count' }, {}, 'status'),
    aggregateChallenges(query, { '*': 'count' }, {}, 'scale'),
    aggregateChallenges(
      { ...query, startTime: ['>=', oneYearAgo] },
      { '*': 'count' },
      {},
      'startTime',
    ),
    topPartnersForPlayer(username, { limit: 8, type: ChallengeType.TOB }),
  ]);

  const statusData = Object.entries(challengeStatuses ?? {}).flatMap(
    ([s, data]) => {
      const status = parseInt(s, 10) as ChallengeStatus;
      if (status === ChallengeStatus.IN_PROGRESS) {
        return [];
      }

      return { status, count: data['*'].count };
    },
  );

  const challengesByScale = Object.entries(challengeScales ?? {}).flatMap(
    ([s, data]) => {
      const scale = parseInt(s, 10);
      return { scale, count: data['*'].count };
    },
  );

  const challengesByDay = Object.entries(challengeCountsLastYear ?? {}).flatMap(
    ([s, data]) => {
      const date = new Date(s);
      return { date, count: data['*'].count };
    },
  );

  return (
    <PlayerOverviewContent
      personalBests={personalBests}
      initialChallengeStatuses={statusData}
      initialChallengesByScale={challengesByScale}
      initialChallengesByDay={challengesByDay}
      topPartners={topPartners ?? []}
    />
  );
}

export const dynamic = 'force-dynamic';
