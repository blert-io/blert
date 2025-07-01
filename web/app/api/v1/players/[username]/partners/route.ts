import { ChallengeMode, ChallengeType } from '@blert/common';
import { NextRequest, NextResponse } from 'next/server';

import {
  PlayerNetworkOptions,
  topPartnersForPlayer,
} from '@/actions/challenge';
import { numericListParam, numericParam } from '@/api/query';
import { InvalidQueryError } from '@/actions/errors';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ username: string }> },
) {
  const { username } = await params;
  const searchParams = request.nextUrl.searchParams;
  const nextParams = Object.fromEntries(searchParams);

  try {
    const options: PlayerNetworkOptions = {
      limit: parseInt(searchParams.get('limit') ?? '10'),
      scale: numericListParam(nextParams, 'scale'),
      mode: numericParam<ChallengeMode>(nextParams, 'mode'),
      type: numericParam<ChallengeType>(nextParams, 'type'),
    };

    if (searchParams.get('from')) {
      options.from = new Date(searchParams.get('from')!);
    }
    if (searchParams.get('to')) {
      options.to = new Date(searchParams.get('to')!);
    }

    const partners = await topPartnersForPlayer(username, options);

    return NextResponse.json(partners);
  } catch (error) {
    if (error instanceof InvalidQueryError) {
      return new Response(null, { status: 400 });
    }
    throw error;
  }
}
