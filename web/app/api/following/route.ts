import { NextRequest } from 'next/server';

import { AuthenticationError, InvalidQueryError } from '@/actions/errors';
import { followPlayer, getFollowing } from '@/actions/feed';
import { expectSingle, numericParam } from '@/api/query';

export async function GET(request: NextRequest) {
  try {
    const searchParams = Object.fromEntries(request.nextUrl.searchParams);
    const cursor = expectSingle(searchParams, 'cursor');
    const limit = numericParam(searchParams, 'limit');

    const result = await getFollowing({ cursor, limit });
    return Response.json(result);
  } catch (error) {
    if (error instanceof InvalidQueryError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof AuthenticationError) {
      return new Response(null, { status: 401 });
    }

    console.error('Failed to fetch following list:', error);
    return new Response(null, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { usernames?: string[] };
    const usernames = body.usernames;

    if (!Array.isArray(usernames) || usernames.length === 0) {
      return Response.json(
        { error: 'Usernames array is required' },
        { status: 400 },
      );
    }

    if (usernames.length > 50) {
      return Response.json(
        { error: 'Maximum 50 usernames per request' },
        { status: 400 },
      );
    }

    for (const username of usernames) {
      if (typeof username !== 'string' || username.length === 0) {
        return Response.json({ error: 'Invalid username' }, { status: 400 });
      }
      if (username.length > 12) {
        return Response.json({ error: 'Invalid username' }, { status: 400 });
      }
    }

    const results = await Promise.all(usernames.map((u) => followPlayer(u)));
    return Response.json(results, { status: 201 });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return new Response(null, { status: 401 });
    }

    console.error('Failed to follow player:', error);
    return new Response(null, { status: 500 });
  }
}
