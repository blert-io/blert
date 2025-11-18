import { SessionStatus } from '@blert/common';

import { GroupedAggregationResult } from '@/actions/challenge';

import { MostActiveTeam, SessionStats } from './activity-dashboard';

export function parseSessionStats(
  sessionsByStatus: Record<
    string,
    {
      '*': { count: number };
      duration: { avg: number };
      challenges: { sum: number };
    }
  > | null,
): SessionStats {
  const sessionStats: SessionStats = {
    total: 0,
    active: 0,
    avgLengthSeconds: 0,
    avgChallenges: 0,
  };

  if (sessionsByStatus === null) {
    return sessionStats;
  }

  let totalDuration = 0;
  let totalChallenges = 0;

  Object.entries(sessionsByStatus).forEach(([s, data]) => {
    const status = parseInt(s, 10) as SessionStatus;
    if (status === SessionStatus.ACTIVE) {
      sessionStats.active += data['*'].count;
    }
    sessionStats.total += data['*'].count;
    totalDuration += data.duration.avg * data['*'].count;
    totalChallenges += data.challenges.sum;
  });
  sessionStats.avgLengthSeconds =
    sessionStats.total > 0 ? totalDuration / sessionStats.total : 0;
  sessionStats.avgChallenges =
    sessionStats.total > 0 ? totalChallenges / sessionStats.total : 0;

  return sessionStats;
}

export function parseMostActiveTeam(
  result: GroupedAggregationResult<
    {
      '*': 'count';
      duration: ('max' | 'sum')[];
    },
    'party'
  >,
): MostActiveTeam | null {
  const team = Object.entries(result)[0];
  if (!team) {
    return null;
  }

  const [party, data] = team;
  return {
    party: party.split(','),
    sessions: data['*'].count,
    maxDurationSeconds: data.duration.max,
    avgDurationSeconds: data.duration.sum / data['*'].count,
  };
}
