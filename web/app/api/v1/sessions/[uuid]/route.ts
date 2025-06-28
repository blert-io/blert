import { NextRequest } from 'next/server';

import { loadSessionWithStats } from '@/actions/challenge';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ uuid: string }> },
) {
  const { uuid } = await params;

  try {
    const session = await loadSessionWithStats(uuid);
    // TODO(frolv): Cache the session if it is completed.
    return Response.json(session);
  } catch (e: any) {
    if (e.name === 'InvalidQueryError') {
      return new Response(null, { status: 400 });
    }

    console.error('Failed to load sessions:', e);
    return new Response(null, { status: 500 });
  }
}
