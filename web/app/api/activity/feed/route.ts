import { NextRequest } from 'next/server';

import { getRecentFeedItems } from '@/actions/activity';
import { withApiRoute } from '@/api/handler';

export const GET = withApiRoute(
  { route: '/api/activity/feed' },
  async (request: NextRequest) => {
    const limit = parseInt(request.nextUrl.searchParams.get('limit') ?? '10');
    if (isNaN(limit)) {
      return Response.json({ error: 'Invalid limit' }, { status: 400 });
    }

    const items = await getRecentFeedItems(limit);
    return Response.json(items);
  },
);
