import { NextRequest } from 'next/server';

import { AggregationKey, SortQuery } from '@/actions/query';
import {
  ChallengeQuery,
  QueryOptions,
  aggregateChallenges,
} from '@/actions/challenge';
import { withApiRoute } from '@/api/handler';
import {
  restoreAggregateAliases,
  parseAggregateParams,
  parseAggregationParam,
  normalizeSortAggregation,
} from '@/api/query';

import { parseChallengeQueryParams } from '../query';

export const GET = withApiRoute(
  { route: '/api/v1/challenges/stats' },
  async (request: NextRequest) => {
    const searchParams = request.nextUrl.searchParams;

    let query: ChallengeQuery;

    try {
      const q = parseChallengeQueryParams(searchParams);
      if (q === null) {
        return new Response(null, { status: 400 });
      }
      query = q;
    } catch {
      return new Response(null, { status: 400 });
    }

    const groupings = (searchParams.get('group') ?? '')
      .split(',')
      .filter((g) => g !== '');

    const options: QueryOptions = { accurateSplits: true };

    const optionsParam = searchParams.get('options');
    if (optionsParam !== null) {
      const opts = optionsParam.split(',');
      for (const opt of opts) {
        switch (opt) {
          case 'accurateSplits': // TODO(frolv): Remove this.
            break;
          case 'noAccurateSplits':
            options.accurateSplits = false;
            break;
          case 'fullRecordings':
            options.fullRecordings = true;
            break;
          default:
            return new Response(null, { status: 400 });
        }
      }
    }

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
      const sort = normalizeSortAggregation(raw);
      if (parseAggregationParam(sort.slice(1)) === null) {
        return new Response(null, { status: 400 });
      }

      options.sort = sort as SortQuery<AggregationKey>;
    }

    const parsed = parseAggregateParams(searchParams.getAll('aggregate'));
    if (parsed === null) {
      return new Response(null, { status: 400 });
    }
    const { aggregations, aliases } = parsed;

    const result = await aggregateChallenges(
      query,
      aggregations,
      options,
      groupings,
    );
    if (result === null) {
      return new Response(null, { status: 404 });
    }

    restoreAggregateAliases(
      result as Record<string, unknown>,
      groupings.length,
      aliases,
    );
    return Response.json(result);
  },
);
