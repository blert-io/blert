import { SplitType } from '@blert/common';
import { NextRequest } from 'next/server';

import { InvalidQueryError } from '@/actions/errors';
import { getSplitPercentiles } from '@/actions/split-distributions';
import { withApiRoute } from '@/api/handler';
import { expectSingle, numericListParam, numericParam } from '@/api/query';

const DEFAULT_PERCENTILES = [5, 25, 50, 75, 95];
const MAX_PERCENTILES = 10;

const CACHE_HEADERS = {
  'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
};

export const GET = withApiRoute(
  { route: '/api/v1/splits/percentiles' },
  async (request: NextRequest) => {
    const params = Object.fromEntries(request.nextUrl.searchParams);

    const types = numericListParam<SplitType>(params, 'types');
    const scale = numericParam(params, 'scale');

    if (types === undefined || types.length === 0 || scale === undefined) {
      throw new InvalidQueryError('Missing required parameters: types, scale');
    }

    if (scale < 1 || scale > 5) {
      throw new InvalidQueryError('scale must be between 1 and 5');
    }

    let percentiles = DEFAULT_PERCENTILES;
    const percentilesParam = expectSingle(params, 'percentiles');
    if (percentilesParam !== undefined) {
      // Parsed manually rather than via numericListParam, which truncates
      // fractional values and silently discards malformed entries.
      const tokens = percentilesParam.split(',');
      percentiles = tokens.map(Number);
      const valid =
        tokens.length > 0 &&
        tokens.length <= MAX_PERCENTILES &&
        tokens.every((t) => t.trim() !== '') &&
        percentiles.every((p) => !isNaN(p) && p >= 0 && p <= 100);
      if (!valid) {
        throw new InvalidQueryError('percentiles must be between 0 and 100');
      }
    }

    let after: Date | undefined;
    const afterParam = expectSingle(params, 'after');
    if (afterParam !== undefined) {
      after = new Date(afterParam);
      if (isNaN(after.getTime())) {
        throw new InvalidQueryError('Invalid after date');
      }
    }

    let before: Date | undefined;
    const beforeParam = expectSingle(params, 'before');
    if (beforeParam !== undefined) {
      before = new Date(beforeParam);
      if (isNaN(before.getTime())) {
        throw new InvalidQueryError('Invalid before date');
      }
    }

    const result = await getSplitPercentiles(
      types,
      scale,
      percentiles,
      after,
      before,
    );
    return Response.json(result, { headers: CACHE_HEADERS });
  },
);
