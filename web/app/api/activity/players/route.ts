import { NextRequest } from 'next/server';

import { getPlayersPerHour } from '@/actions/activity';

export async function GET(request: NextRequest) {
  const startTime = new Date();
  startTime.setHours(startTime.getHours() - 24);

  const playersPerHour = await getPlayersPerHour(startTime);
  return Response.json(playersPerHour);
}
