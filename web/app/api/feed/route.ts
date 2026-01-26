import { NextRequest } from 'next/server';

import { AuthenticationError } from '@/actions/errors';
import { loadFeed } from '@/actions/feed';
import { clamp } from '@/utils/math';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  const limit = clamp(parseInt(searchParams.get('limit') ?? '20'), 1, 50);
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

    console.error('Failed to fetch personalized feed:', error);
    return new Response(null, { status: 500 });
  }
}
