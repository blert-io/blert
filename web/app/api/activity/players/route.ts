import { NextRequest } from 'next/server';

import { getPlayersPerHour, playerActivityByHour } from '@/actions/activity';

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

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  const period = params.get('period') ?? 'day';
  const startTime = periodToStartTime(period);

  if (params.has('username')) {
    const username = params.get('username')!;
    const playersPerHour = await playerActivityByHour(username, startTime);
    return Response.json(playersPerHour);
  }

  const playersPerHour = await getPlayersPerHour(startTime);
  return Response.json(playersPerHour);
}
