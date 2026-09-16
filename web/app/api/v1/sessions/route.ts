import { NextRequest } from 'next/server';

import { loadSessionsPage } from '@/actions/challenge';
import { withApiRoute } from '@/api/handler';
import { integerParam } from '@/api/query';
import { requestParams } from '@/utils/url';

import { parseSessionQuery } from './query';

export const GET = withApiRoute(
  { route: '/api/v1/sessions' },
  async (request: NextRequest) => {
    const params = requestParams(request.nextUrl.searchParams);

    const limit = integerParam(params, 'limit', 1, 100) ?? 10;
    const query = parseSessionQuery(params);

    const { sessions, total, remaining } = await loadSessionsPage(limit, query);

    return new Response(JSON.stringify(sessions), {
      headers: {
        'Content-Type': 'application/json',
        'X-Total-Count': String(total),
        'X-Remaining-Count': String(remaining),
      },
    });
  },
);
