import { NextRequest } from 'next/server';

import { verifyDiscordLink } from '@/actions/admin';
import { withApiRoute } from '@/api/handler';

import { validateDiscordBotAuth } from '../auth';

type VerifyLinkRequest = {
  code: string;
  discordId: string;
  discordUsername: string;
};

/**
 * Admin endpoint for Discord bot to verify a linking code and link a Discord
 * account to a Blert account.
 *
 * @param request Request with `{ code, discordId, discordUsername }` in body.
 * @returns 200 with user info on success, or error response on failure.
 */
export const POST = withApiRoute(
  { route: '/api/admin/verify-link' },
  async (request: NextRequest) => {
    const authHeader = request.headers.get('authorization');
    if (!validateDiscordBotAuth(authHeader)) {
      return Response.json({ error: 'unauthorized' }, { status: 401 });
    }

    let body: VerifyLinkRequest;
    try {
      body = (await request.json()) as VerifyLinkRequest;
    } catch {
      return Response.json({ error: 'invalid_body' }, { status: 400 });
    }

    const { code, discordId, discordUsername } = body;

    if (!code || !discordId || !discordUsername) {
      return Response.json({ error: 'missing_fields' }, { status: 400 });
    }

    try {
      const result = await verifyDiscordLink(code, discordId, discordUsername);

      if (!result.success) {
        const statusMap = {
          invalid_code: 404,
          expired: 410,
          conflict: 409,
          user_not_found: 404,
          internal_error: 500,
        } as const;
        return Response.json(
          { error: result.error },
          { status: statusMap[result.error] },
        );
      }

      return Response.json(result);
    } catch {
      return Response.json({ error: 'internal_error' }, { status: 500 });
    }
  },
);
