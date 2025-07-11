import { EventType, Stage } from '@blert/common';
import { NextRequest } from 'next/server';

import { loadEventsForStage } from '@/actions/challenge';
import { parseIntParam } from '@/utils/params';

type Params = {
  params: Promise<{ id: string }>;
};

export async function GET(request: NextRequest, { params }: Params) {
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

  try {
    const events = await loadEventsForStage(id, room, type);
    if (events === null) {
      return new Response(null, { status: 404 });
    }
    return Response.json(events);
  } catch (e) {
    console.error('Failed to load events:', e);
    return new Response(null, { status: 500 });
  }
}
