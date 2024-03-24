import { EventType, Stage } from '@blert/common';
import { NextRequest } from 'next/server';

import { loadEventsForStage } from '../../../../../../actions/raid';

type Params = {
  params: { id: string };
};

function parseIntParam<Enum>(
  searchParams: URLSearchParams,
  key: string,
): Enum | undefined {
  const value = searchParams.get(key);
  if (value === null) {
    return undefined;
  }

  const parsed = parseInt(value);
  return Number.isNaN(parsed) ? undefined : (parsed as Enum);
}

export async function GET(request: NextRequest, { params }: Params) {
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

  const events = await loadEventsForStage(params.id, room, type);
  return Response.json(events);
}
