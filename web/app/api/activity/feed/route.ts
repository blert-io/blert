import { getRecentFeedItems } from '@/actions/activity';
import { NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
  const limit = parseInt(request.nextUrl.searchParams.get('limit') ?? '10');
  if (isNaN(limit)) {
    return Response.json({ error: 'Invalid limit' }, { status: 400 });
  }

  try {
    const items = await getRecentFeedItems(limit);
    return Response.json(items);
  } catch (error) {
    console.error('Failed to fetch activity feed:', error);
    return new Response(null, { status: 500 });
  }
}
