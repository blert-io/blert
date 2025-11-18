import { ChallengeStatus, ChallengeType } from '@blert/common';

import {
  ChallengeQuery,
  SessionQuery,
  aggregateChallenges,
  aggregateSessions,
} from '@/actions/challenge';

import ActivityDashboard, { MostActiveTeam } from './activity-dashboard';
import FilteredSessionList from './filtered-session-list';
import { parseMostActiveTeam, parseSessionStats } from './query';

import styles from './style.module.scss';

function startOfDateUtc(): Date {
  const date = new Date();
  date.setUTCHours(0);
  date.setUTCMinutes(0);
  date.setUTCSeconds(0);
  date.setUTCMilliseconds(0);
  return date;
}

type ChallengePageProps = {
  type: ChallengeType;
};

export default async function Page({ type }: ChallengePageProps) {
  const challengeFilter: ChallengeQuery = {
    type: ['==', type],
    startTime: ['>=', startOfDateUtc()],
  };

  const statsQuery = aggregateChallenges(
    challengeFilter,
    {
      '*': 'count',
      challengeTicks: 'sum',
      totalDeaths: 'sum',
    },
    {},
  );

  const statusQuery = aggregateChallenges(
    challengeFilter,
    { '*': 'count' },
    {},
    'status',
  );
  const scaleQuery = aggregateChallenges(
    challengeFilter,
    { '*': 'count' },
    {},
    'scale',
  );
  const playerQuery = aggregateChallenges(
    challengeFilter,
    { '*': 'count' },
    { limit: 10, sort: '-count' },
    'username',
  );
  const sessionQuery = aggregateSessions(
    challengeFilter as SessionQuery,
    { '*': 'count', duration: 'avg', challenges: 'sum' },
    {},
    'status',
  );
  const mostActiveTeamQuery = aggregateSessions(
    challengeFilter as SessionQuery,
    { '*': 'count', duration: ['max', 'sum'] },
    { sort: '-duration:sum', limit: 3 },
    'party',
  );

  const [
    todaysStats,
    raidStatuses,
    raidScales,
    players,
    sessionsByStatus,
    mostActiveTeam,
  ] = await Promise.all([
    statsQuery,
    statusQuery,
    scaleQuery,
    playerQuery,
    sessionQuery,
    mostActiveTeamQuery,
  ]);

  const statusData = Object.entries(raidStatuses ?? {}).flatMap(([s, data]) => {
    const status = parseInt(s, 10) as ChallengeStatus;
    if (status === ChallengeStatus.IN_PROGRESS) {
      return [];
    }

    return { key: status, value: data['*'].count };
  });

  const scaleData = Object.entries(raidScales ?? {}).map(([s, data]) => ({
    key: parseInt(s, 10),
    value: data['*'].count,
  }));

  const playerData = Object.entries(players ?? {}).map(([p, data]) => ({
    key: p,
    value: data['*'].count,
  }));
  playerData.sort((a, b) => b.value - a.value);

  const sessionStats = parseSessionStats(sessionsByStatus);

  let mostActiveTeamData: MostActiveTeam | null = null;
  if (mostActiveTeam) {
    mostActiveTeamData = parseMostActiveTeam(mostActiveTeam);
  }

  return (
    <div className={styles.challengePage}>
      <div className={styles.content}>
        <div className={styles.dashboardSidebar}>
          <ActivityDashboard
            challengeType={type}
            initialDailyStats={todaysStats}
            initialPlayerData={playerData}
            initialScaleData={scaleData}
            initialStatusData={statusData}
            initialSessionStats={sessionStats}
            initialMostActiveTeam={mostActiveTeamData}
          />
        </div>
        <div className={styles.challengeSection}>
          <FilteredSessionList type={type} />
        </div>
      </div>
    </div>
  );
}
