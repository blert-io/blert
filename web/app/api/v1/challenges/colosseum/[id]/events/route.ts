import { EventType, Stage } from '@blert/common';
import { NextRequest } from 'next/server';

import { loadEventsForStage } from '../../../../../../actions/challenge';
import { parseIntParam } from '../../../../../../utils/params';

type Params = {
  params: { id: string };
};

export async function GET(request: NextRequest, { params }: Params) {
  const searchParams = request.nextUrl.searchParams;
  const stage = parseIntParam<Stage>(searchParams, 'stage');
  if (
    stage === undefined ||
    stage < Stage.COLOSSEUM_WAVE_1 ||
    stage > Stage.COLOSSEUM_WAVE_12
  ) {
    return new Response(null, { status: 400 });
  }

  const type = parseIntParam<EventType>(searchParams, 'type');

  try {
    const events = await loadEventsForStage(params.id, stage, type);
    if (events === null) {
      return new Response(null, { status: 404 });
    }
    return Response.json(events);
  } catch (e) {
    return new Response(null, { status: 500 });
  }
}
