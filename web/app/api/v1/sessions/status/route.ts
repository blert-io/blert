import { NextRequest } from 'next/server';

import { getSessionStatuses } from '@/actions/challenge';
import { withApiRoute } from '@/api/handler';

export const GET = withApiRoute(
  { route: '/api/v1/sessions/status' },
  async (request: NextRequest) => {
    const uuids = request.nextUrl.searchParams.get('uuids');
    if (uuids === null || uuids === '') {
      return Response.json([]);
    }

    const uuidList = uuids.split(',');
    const statuses = await getSessionStatuses(uuidList);
    return Response.json(statuses);
  },
);
