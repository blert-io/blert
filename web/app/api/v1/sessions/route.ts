import { NextRequest } from 'next/server';

import { loadSessionsPage } from '@/actions/challenge';
import { withApiRoute } from '@/api/handler';
import { clamp } from '@/utils/math';

import { parseSessionQueryParams } from './query';

export const GET = withApiRoute(
  { route: '/api/v1/sessions' },
  async (request: NextRequest) => {
    const searchParams = request.nextUrl.searchParams;

    const limit = clamp(parseInt(searchParams.get('limit') ?? '10'), 1, 100);

    const query = parseSessionQueryParams(searchParams);

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
