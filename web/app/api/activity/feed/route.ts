import { NextRequest } from 'next/server';

import { getRecentFeedItems } from '@/actions/activity';
import { withApiRoute } from '@/api/handler';
import { integerParam } from '@/api/query';
import { requestParams } from '@/utils/url';

export const GET = withApiRoute(
  { route: '/api/activity/feed' },
  async (request: NextRequest) => {
    const params = requestParams(request.nextUrl.searchParams);
    const limit = integerParam(params, 'limit', 1, 100) ?? 10;

    const items = await getRecentFeedItems(limit);
    return Response.json(items);
  },
);
