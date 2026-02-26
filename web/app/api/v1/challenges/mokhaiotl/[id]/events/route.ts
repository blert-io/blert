import { EventType, Stage } from '@blert/common';
import { NextRequest } from 'next/server';

import { loadEventsForStage } from '@/actions/challenge';
import { withApiRoute } from '@/api/handler';
import { parseIntParam } from '@/utils/params';

export const GET = withApiRoute(
  { route: '/api/v1/challenges/mokhaiotl/[id]/events' },
  async (request: NextRequest, { params }) => {
    const { id } = await params;
    const searchParams = request.nextUrl.searchParams;

    let stage: Stage | undefined;
    let attempt = undefined;

    if (searchParams.has('delve')) {
      const delve = parseIntParam<number>(searchParams, 'delve');
      if (delve === undefined || delve < 1) {
        return new Response(null, { status: 400 });
      }
      stage = Stage.MOKHAIOTL_DELVE_1 + Math.min(delve, 9) - 1;
      attempt = delve > 8 ? delve - 8 : undefined;
    } else {
      stage = parseIntParam<Stage>(searchParams, 'stage');
      attempt = parseIntParam<number>(searchParams, 'attempt');
    }

    if (!stage) {
      return new Response(null, { status: 400 });
    }

    const type = parseIntParam<EventType>(searchParams, 'type');

    const events = await loadEventsForStage(id, stage, type, attempt);
    if (events === null) {
      return new Response(null, { status: 404 });
    }
    return Response.json(events);
  },
);
