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

  const events = await loadEventsForStage(params.id, stage, type);
  return Response.json(events);
}
