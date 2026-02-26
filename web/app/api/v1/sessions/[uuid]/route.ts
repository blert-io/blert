import { NextRequest } from 'next/server';

import { loadSessionWithStats } from '@/actions/challenge';
import { withApiRoute } from '@/api/handler';

export const GET = withApiRoute(
  { route: '/api/v1/sessions/[uuid]' },
  async (_request: NextRequest, { params }) => {
    const { uuid } = await params;

    // TODO(frolv): Cache the session if it is completed.
    const session = await loadSessionWithStats(uuid);
    return Response.json(session);
  },
);
