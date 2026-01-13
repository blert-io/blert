import { NextRequest } from 'next/server';

import { grantApiAccess } from '@/actions/admin';

import { validateDiscordBotAuth } from '../auth';

type GrantApiAccessRequest = {
  discordId: string;
};

/**
 * Admin endpoint for Discord bot to grant API key creation access to a user.
 *
 * @param request Request with `{ discordId }` in body.
 * @returns 200 with user info on success, or error response on failure.
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!validateDiscordBotAuth(authHeader)) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: GrantApiAccessRequest;
  try {
    body = (await request.json()) as GrantApiAccessRequest;
  } catch {
    return Response.json({ error: 'invalid_body' }, { status: 400 });
  }

  const { discordId } = body;

  if (!discordId) {
    return Response.json({ error: 'missing_fields' }, { status: 400 });
  }

  try {
    const result = await grantApiAccess(discordId);

    if (!result.success) {
      switch (result.error) {
        case 'user_not_found':
          return Response.json({ error: result.error }, { status: 404 });
        case 'limit_reached':
          return Response.json({ error: result.error }, { status: 403 });
        case 'unavailable':
          return Response.json({ error: result.error }, { status: 503 });
      }
    }

    return Response.json(result);
  } catch (error) {
    console.error('Error granting API access:', error);
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
}
