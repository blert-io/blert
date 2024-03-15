import { EventType, Room } from '@blert/common';
import { NextRequest } from 'next/server';

import { loadEventsForRoom } from '../../../../../../actions/raid';

type Params = {
  params: { id: string };
};

export async function GET(request: NextRequest, { params }: Params) {
  const searchParams = request.nextUrl.searchParams;
  const room = searchParams.get('room');
  if (room === null) {
    return new Response(null, { status: 400 });
  }

  const type = (searchParams.get('type') as EventType) ?? undefined;

  const events = await loadEventsForRoom(
    params.id,
    room.toUpperCase() as Room,
    type,
  );
  return Response.json(events);
}
