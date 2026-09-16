import { ChallengeMode, ChallengeType } from '@blert/common';
import { NextRequest, NextResponse } from 'next/server';

import {
  PlayerNetworkOptions,
  topPartnersForPlayer,
} from '@/actions/challenge';
import {
  dateParam,
  enumParam,
  integerListParam,
  integerParam,
} from '@/api/query';
import { withApiRoute } from '@/api/handler';
import { requestParams } from '@/utils/url';

export const GET = withApiRoute(
  { route: '/api/v1/players/[username]/partners' },
  async (request: NextRequest, { params: path }) => {
    const { username } = await path;
    const params = requestParams(request.nextUrl.searchParams);

    const options: PlayerNetworkOptions = {
      limit: integerParam(params, 'limit', 1) ?? 10,
      scale: integerListParam(params, 'scale', 1, 8),
      mode: enumParam(ChallengeMode, params, 'mode'),
      type: enumParam(ChallengeType, params, 'type'),
      from: dateParam(params, 'from'),
      to: dateParam(params, 'to'),
    };

    const partners = await topPartnersForPlayer(username, options);
    if (partners === null) {
      return new Response(null, { status: 404 });
    }

    return NextResponse.json(partners);
  },
);
