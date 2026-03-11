import { SplitType } from '@blert/common';
import { NextRequest } from 'next/server';

import {
  getFilteredSplitDistributions,
  SplitTier,
} from '@/actions/split-distributions';
import { withApiRoute } from '@/api/handler';
import { expectSingle, numericListParam, numericParam } from '@/api/query';

const VALID_TIERS = ['standard', 'speedrun'];
function isSplitTier(value: string): value is SplitTier {
  return VALID_TIERS.includes(value);
}

const MAX_PLAYERS = 5;

export const GET = withApiRoute(
  { route: '/api/v1/splits/distributions/query' },
  async (request: NextRequest) => {
    const params = Object.fromEntries(request.nextUrl.searchParams);

    const partyParam = expectSingle(params, 'party');
    if (partyParam === undefined || partyParam.length === 0) {
      return Response.json(
        { error: 'Missing required parameter: party' },
        { status: 400 },
      );
    }

    const party = partyParam.split(',').filter((p) => p.length > 0);
    if (party.length === 0 || party.length > MAX_PLAYERS) {
      return Response.json(
        { error: `party must contain 1-${MAX_PLAYERS} usernames` },
        { status: 400 },
      );
    }

    const types = numericListParam<SplitType>(params, 'types');
    const scale = numericParam(params, 'scale');

    if (types === undefined || types.length === 0 || scale === undefined) {
      return Response.json(
        { error: 'Missing required parameters: types, scale' },
        { status: 400 },
      );
    }

    if (scale < 1 || scale > 5) {
      return Response.json({ error: 'Invalid scale' }, { status: 400 });
    }

    const tierParam = expectSingle(params, 'tier');
    let tier: SplitTier | undefined;
    if (tierParam !== undefined) {
      if (!isSplitTier(tierParam)) {
        return Response.json({ error: 'Invalid tier' }, { status: 400 });
      }
      tier = tierParam;
    }

    let after: Date | undefined;
    const afterParam = expectSingle(params, 'after');
    if (afterParam !== undefined) {
      after = new Date(afterParam);
      if (isNaN(after.getTime())) {
        return Response.json({ error: 'Invalid after date' }, { status: 400 });
      }
    }

    let before: Date | undefined;
    const beforeParam = expectSingle(params, 'before');
    if (beforeParam !== undefined) {
      before = new Date(beforeParam);
      if (isNaN(before.getTime())) {
        return Response.json({ error: 'Invalid before date' }, { status: 400 });
      }
    }

    const distributions = await getFilteredSplitDistributions(
      party,
      types,
      scale,
      tier,
      after,
      before,
    );

    return Response.json(distributions);
  },
);
