import { ChallengeMode, ChallengeType } from '@blert/common';
import { NextRequest, NextResponse } from 'next/server';

import { loadPlayerNetwork, PlayerNetworkOptions } from '@/actions/challenge';
import { InvalidQueryError } from '@/actions/errors';
import { numericListParam, numericParam } from '@/api/query';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const nextParams = Object.fromEntries(searchParams);

  try {
    const options: PlayerNetworkOptions = {
      limit: numericParam(nextParams, 'limit'),
      scale: numericListParam(nextParams, 'scale'),
      mode: numericParam<ChallengeMode>(nextParams, 'mode'),
      type: numericParam<ChallengeType>(nextParams, 'type'),
      minChallengesTogether: numericParam(nextParams, 'minConnections'),
    };

    if (searchParams.get('from')) {
      options.from = new Date(searchParams.get('from')!);
    }
    if (searchParams.get('to')) {
      options.to = new Date(searchParams.get('to')!);
    }

    const network = await loadPlayerNetwork(options);
    return NextResponse.json(network);
  } catch (error) {
    if (error instanceof InvalidQueryError) {
      return new Response(null, { status: 400 });
    }
    throw error;
  }
}
