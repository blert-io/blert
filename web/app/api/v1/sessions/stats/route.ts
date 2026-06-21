import { NextRequest } from 'next/server';

import { AggregationKey, SortQuery } from '@/actions/query';
import {
  aggregateSessions,
  SessionAggregationOptions,
} from '@/actions/challenge';
import { withApiRoute } from '@/api/handler';
import {
  restoreAggregateAliases,
  parseAggregateParams,
  normalizeSortAggregation,
} from '@/api/query';

import { parseSessionQueryParams } from '../query';

export const GET = withApiRoute(
  { route: '/api/v1/sessions/stats' },
  async (request: NextRequest) => {
    const searchParams = request.nextUrl.searchParams;

    const options: SessionAggregationOptions = {};

    if (searchParams.has('limit')) {
      const limit = parseInt(searchParams.get('limit')!);
      if (isNaN(limit) || limit < 0) {
        return new Response(null, { status: 400 });
      }
      options.limit = limit;
    }

    if (searchParams.has('sort')) {
      const raw = searchParams.get('sort')!;
      if (!raw.startsWith('-') && !raw.startsWith('+')) {
        return new Response(null, { status: 400 });
      }
      options.sort = normalizeSortAggregation(raw) as SortQuery<AggregationKey>;
    }

    const parsed = parseAggregateParams(searchParams.getAll('aggregate'));
    if (parsed === null) {
      return new Response(null, { status: 400 });
    }
    const { aggregations, aliases } = parsed;

    const groupings = (searchParams.get('group') ?? '')
      .split(',')
      .filter((g) => g !== '');

    const query = parseSessionQueryParams(searchParams);
    const result = await aggregateSessions(
      query,
      aggregations,
      options,
      groupings,
    );
    if (result !== null) {
      restoreAggregateAliases(
        result as Record<string, unknown>,
        groupings.length,
        aliases,
      );
    }
    return Response.json(result);
  },
);
