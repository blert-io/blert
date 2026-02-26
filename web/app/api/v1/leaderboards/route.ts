import { NextRequest } from 'next/server';

import { findBestSplitTimes } from '@/actions/challenge';
import { withApiRoute } from '@/api/handler';

export const GET = withApiRoute(
  { route: '/api/v1/leaderboards' },
  async (request: NextRequest) => {
    const params = request.nextUrl.searchParams;

    const splits = (params.get('splits') ?? '')
      .split(',')
      .map((s) => parseInt(s));
    const scale = parseInt(params.get('scale') ?? '-1');
    const limit = parseInt(params.get('limit') ?? '10');
    const tiedTeamsLimit = parseInt(params.get('tiedTeamsLimit') ?? '10');

    if (scale === -1 || splits.length === 0 || splits.some(isNaN)) {
      return Response.json(null, { status: 400 });
    }

    if (isNaN(tiedTeamsLimit) || tiedTeamsLimit < 0 || tiedTeamsLimit > 50) {
      return Response.json(null, { status: 400 });
    }

    let startTime: Date | undefined = undefined;
    if (params.get('from')) {
      const time = parseInt(params.get('from')!);
      if (isNaN(time)) {
        return Response.json(null, { status: 400 });
      }
      startTime = new Date(time);
    }

    const rankedSplits = await findBestSplitTimes(
      splits,
      scale,
      limit,
      startTime,
      tiedTeamsLimit,
    );
    return Response.json(rankedSplits);
  },
);
