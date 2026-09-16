import { EventType, Stage } from '@blert/common';
import { NextRequest } from 'next/server';

import { loadEventsForStage } from '@/actions/challenge';
import { InvalidQueryError } from '@/actions/errors';
import { withApiRoute } from '@/api/handler';
import { integerParam } from '@/api/query';
import { parseIntParam } from '@/utils/params';
import { requestParams } from '@/utils/url';

export const GET = withApiRoute(
  { route: '/api/v1/challenges/mokhaiotl/[id]/events' },
  async (request: NextRequest, { params: path }) => {
    const { id } = await path;
    const params = requestParams(request.nextUrl.searchParams);

    let stage: Stage | undefined;
    let attempt: number | undefined;

    const delve = integerParam(params, 'delve', 1);
    if (delve !== undefined) {
      stage = Stage.MOKHAIOTL_DELVE_1 + Math.min(delve, 9) - 1;
      attempt = delve > 8 ? delve - 8 : undefined;
    } else {
      stage = integerParam<Stage>(
        params,
        'stage',
        Stage.MOKHAIOTL_DELVE_1,
        Stage.MOKHAIOTL_DELVE_8PLUS,
      );
      attempt = integerParam(params, 'attempt', 1);
    }

    if (stage === undefined) {
      throw new InvalidQueryError('Missing stage or delve');
    }

    const type = parseIntParam<EventType>(request.nextUrl.searchParams, 'type');

    const events = await loadEventsForStage(id, stage, type, attempt);
    if (events === null) {
      return new Response(null, { status: 404 });
    }
    return Response.json(events);
  },
);
