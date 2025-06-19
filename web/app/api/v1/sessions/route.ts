import { NextRequest } from 'next/server';

import { loadSessions } from '@/actions/challenge';
import { clamp } from '@/utils/math';

import { parseSessionQueryParams } from './query';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  const limit = clamp(parseInt(searchParams.get('limit') ?? '10'), 1, 100);

  try {
    const query = parseSessionQueryParams(searchParams);
    const sessions = await loadSessions(limit, query);
    return Response.json(sessions);
  } catch (e: any) {
    if (e.name === 'InvalidQueryError') {
      return new Response(null, { status: 400 });
    }

    console.error('Failed to load sessions:', e);
    return new Response(null, { status: 500 });
  }
}
