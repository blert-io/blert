import { EventType, isTfaStage, Stage } from '@blert/common';
import { NextRequest } from 'next/server';

import { loadEventsForStage } from '@/actions/challenge';
import { InvalidQueryError } from '@/actions/errors';
import { withApiRoute } from '@/api/handler';
import { enumParam } from '@/api/query';
import { requestParams } from '@/utils/url';

export const GET = withApiRoute(
  { route: '/api/v1/raids/tfa/[id]/events' },
  async (request: NextRequest, { params: path }) => {
    const { id } = await path;
    const params = requestParams(request.nextUrl.searchParams);

    const stage = enumParam(Stage, params, 'stage');
    if (stage === undefined) {
      throw new InvalidQueryError('Missing stage');
    }
    if (!isTfaStage(stage)) {
      throw new InvalidQueryError(`stage: Invalid value ${stage}`);
    }

    const type = enumParam(EventType, params, 'type');

    const events = await loadEventsForStage(id, stage, type);
    if (events === null) {
      return new Response(null, { status: 404 });
    }
    return Response.json(events);
  },
);
