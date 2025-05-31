import { ChallengeStatus, ChallengeType } from '@blert/common';

import {
  aggregateChallenges,
  ChallengeQuery,
  loadPbsForPlayer,
} from '@/actions/challenge';

import PlayerOverviewContent from './overview-content';

export default async function PlayerOverview({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const username = await params.then((p) => decodeURIComponent(p.username));

  const query: ChallengeQuery = {
    type: ['==', ChallengeType.TOB],
    party: [username],
  };

  const oneYearAgo = new Date();
  oneYearAgo.setUTCFullYear(oneYearAgo.getUTCFullYear() - 1);
  oneYearAgo.setUTCHours(0, 0, 0, 0);

  const [personalBests, raidStatuses, raidScales, raidCountsLastYear] =
    await Promise.all([
      loadPbsForPlayer(username),
      aggregateChallenges(query, { '*': 'count' }, {}, 'status'),
      aggregateChallenges(query, { '*': 'count' }, {}, 'scale'),
      aggregateChallenges(
        { ...query, startTime: ['>=', oneYearAgo] },
        { '*': 'count' },
        {},
        'startTime',
      ),
    ]);

  const statusData = Object.entries(raidStatuses ?? {}).flatMap(([s, data]) => {
    const status = parseInt(s, 10) as ChallengeStatus;
    if (status === ChallengeStatus.IN_PROGRESS) {
      return [];
    }

    return { status, count: data['*'].count };
  });

  const raidsByScale = Object.entries(raidScales ?? {}).flatMap(([s, data]) => {
    const scale = parseInt(s, 10) as number;
    return { scale, count: data['*'].count };
  });

  const raidsByDay = Object.entries(raidCountsLastYear ?? {}).flatMap(
    ([s, data]) => {
      const date = new Date(s);
      return { date, count: data['*'].count };
    },
  );

  return (
    <PlayerOverviewContent
      personalBests={personalBests}
      initialRaidStatuses={statusData}
      initialRaidsByScale={raidsByScale}
      initialRaidsByDay={raidsByDay}
    />
  );
}

export const dynamic = 'force-dynamic';
