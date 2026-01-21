import { NextRequest } from 'next/server';

import { getLinkedRsns } from '@/actions/admin';

import { validateDiscordBotAuth } from '../auth';

type LinkedRsnsRequest = {
  discordIds: string[];
};

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!validateDiscordBotAuth(authHeader)) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: LinkedRsnsRequest;
  try {
    body = (await request.json()) as LinkedRsnsRequest;
  } catch {
    return Response.json({ error: 'invalid_body' }, { status: 400 });
  }

  const { discordIds } = body;

  if (!discordIds || !Array.isArray(discordIds) || discordIds.length === 0) {
    return Response.json({ error: 'missing_fields' }, { status: 400 });
  }

  try {
    const results = await getLinkedRsns(discordIds);
    return Response.json({ results });
  } catch (error) {
    console.error('Error fetching linked RSNs:', error);
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
}
