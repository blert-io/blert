import { EventType, Stage } from '@blert/common';
import { NextRequest } from 'next/server';

import { loadEventsForStage } from '@/actions/challenge';
import { withApiRoute } from '@/api/handler';
import { parseIntParam } from '@/utils/params';

export const GET = withApiRoute(
  { route: '/api/v1/raids/tob/[id]/events' },
  async (request: NextRequest, { params }) => {
    const { id } = await params;

    const searchParams = request.nextUrl.searchParams;
    const room = parseIntParam<Stage>(searchParams, 'stage');
    if (
      room === undefined ||
      room < Stage.TOB_MAIDEN ||
      room > Stage.TOB_VERZIK
    ) {
      return new Response(null, { status: 400 });
    }

    const type = parseIntParam<EventType>(searchParams, 'type');

    const events = await loadEventsForStage(id, room, type);
    if (events === null) {
      return new Response(null, { status: 404 });
    }
    return Response.json(events);
  },
);
