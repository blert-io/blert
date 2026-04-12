import { ChallengeType } from '@blert/common';
import { NextRequest } from 'next/server';

import { getPlayersPerHour, playerActivityByHour } from '@/actions/activity';
import { withApiRoute } from '@/api/handler';
import { expectSingle, numericParam } from '@/api/query';

function periodToStartTime(period: string) {
  const startTime = new Date();

  switch (period) {
    case 'day':
      startTime.setHours(startTime.getHours() - 24);
      break;
    case 'week':
      startTime.setDate(startTime.getDate() - 7);
      break;
    case 'month':
      startTime.setMonth(startTime.getMonth() - 1);
      break;
    case 'all':
      return new Date(0);
    default:
      throw new Error(`Invalid period: ${period}`);
  }

  return startTime;
}

export const GET = withApiRoute(
  { route: '/api/activity/players' },
  async (request: NextRequest) => {
    const searchParams = request.nextUrl.searchParams;
    const params = Object.fromEntries(searchParams);

    const period = expectSingle(params, 'period') ?? 'day';
    const startTime = periodToStartTime(period);

    const challengeType = numericParam<ChallengeType>(params, 'type');

    if (searchParams.has('username')) {
      const username = searchParams.get('username')!;
      const playersPerHour = await playerActivityByHour(username, startTime);
      return Response.json(playersPerHour);
    }

    const playersPerHour = await getPlayersPerHour(startTime, challengeType);
    return Response.json(playersPerHour);
  },
);
