import { NextRequest } from 'next/server';

import { aggregateSessions, loadSessions } from '@/actions/challenge';
import { withApiRoute } from '@/api/handler';
import { clamp } from '@/utils/math';

import { parseSessionQueryParams } from './query';

export const GET = withApiRoute(
  { route: '/api/v1/sessions' },
  async (request: NextRequest) => {
    const searchParams = request.nextUrl.searchParams;

    const limit = clamp(parseInt(searchParams.get('limit') ?? '10'), 1, 100);

    const query = parseSessionQueryParams(searchParams);

    const countQuery = {
      ...query,
      before: undefined,
      after: undefined,
    };

    const [sessions, countResult] = await Promise.all([
      loadSessions(limit, query),
      aggregateSessions(countQuery, { '*': 'count' }),
    ]);

    const count = countResult?.['*']?.count ?? 0;

    let remaining = 0;
    if (sessions.length > 0) {
      const includeStatus = query.status === undefined;
      const boundarySession =
        query.before !== undefined
          ? sessions[0]
          : sessions[sessions.length - 1];
      const cursor = includeStatus
        ? [boundarySession.status, boundarySession.startTime.getTime()]
        : [boundarySession.startTime.getTime()];
      const remainingResult = await aggregateSessions(
        { ...countQuery, after: cursor },
        { '*': 'count' },
      );
      remaining = remainingResult?.['*']?.count ?? 0;
    }
    return new Response(JSON.stringify(sessions), {
      headers: {
        'Content-Type': 'application/json',
        'X-Total-Count': String(count),
        'X-Remaining-Count': String(remaining),
      },
    });
  },
);
