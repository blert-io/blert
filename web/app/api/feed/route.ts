import { NextRequest } from 'next/server';

import { AuthenticationError } from '@/actions/errors';
import { loadFeed } from '@/actions/feed';
import { withApiRoute } from '@/api/handler';
import { integerParam } from '@/api/query';
import { requestParams } from '@/utils/url';

export const GET = withApiRoute(
  { route: '/api/feed' },
  async (request: NextRequest) => {
    const searchParams = request.nextUrl.searchParams;
    const params = requestParams(searchParams);

    const limit = integerParam(params, 'limit', 1, 50) ?? 20;
    const cursor = searchParams.get('cursor') ?? undefined;
    const directionParam = searchParams.get('direction');

    const direction =
      directionParam === 'newer' || directionParam === 'older'
        ? directionParam
        : 'older';

    try {
      const result = await loadFeed({ cursor, direction, limit });
      return Response.json(result);
    } catch (error) {
      if (error instanceof AuthenticationError) {
        return new Response(null, { status: 401 });
      }
      throw error;
    }
  },
);
