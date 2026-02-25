import { SplitType } from '@blert/common';
import { NextRequest } from 'next/server';

import { InvalidQueryError } from '@/actions/errors';
import {
  getSplitDistributions,
  SplitTier,
} from '@/actions/split-distributions';
import { withApiRoute } from '@/api/handler';
import { expectSingle, numericListParam, numericParam } from '@/api/query';

const VALID_TIERS = ['standard', 'speedrun'];
function isSplitTier(value: string): value is SplitTier {
  return VALID_TIERS.includes(value);
}

const CACHE_HEADERS = {
  'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
};

export const GET = withApiRoute(
  { route: '/api/v1/splits/distributions' },
  async (request: NextRequest) => {
    const params = Object.fromEntries(request.nextUrl.searchParams);

    const types = numericListParam<SplitType>(params, 'types');
    const scale = numericParam(params, 'scale');

    if (types === undefined || types.length === 0 || scale === undefined) {
      return Response.json(
        { error: 'Missing required parameters' },
        { status: 400 },
      );
    }

    if (scale < 1 || scale > 5) {
      return Response.json({ error: 'Invalid scale' }, { status: 400 });
    }

    const tier = expectSingle(params, 'tier');
    if (tier !== undefined && !isSplitTier(tier)) {
      return Response.json({ error: 'Invalid tier' }, { status: 400 });
    }

    try {
      const distributions = await getSplitDistributions(types, scale, tier);
      return Response.json(distributions, { headers: CACHE_HEADERS });
    } catch (e) {
      if (e instanceof InvalidQueryError) {
        return Response.json({ error: e.message }, { status: 400 });
      }
      throw e;
    }
  },
);
