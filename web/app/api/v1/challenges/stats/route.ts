import { NextRequest } from 'next/server';

import { isAggregation } from '@/api/query';
import {
  Aggregation,
  AggregationQuery,
  ChallengeQuery,
  QueryOptions,
  SortQuery,
  aggregateChallenges,
} from '@/actions/challenge';
import { withApiRoute } from '@/api/handler';

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

    const options: QueryOptions = {};

    const optionsParam = searchParams.get('options');
    if (optionsParam !== null) {
      const opts = optionsParam.split(',');
      for (const opt of opts) {
        switch (opt) {
          case 'accurateSplits':
            options.accurateSplits = true;
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
      const sort = searchParams.get('sort')!;
      if (!sort.startsWith('-') && !sort.startsWith('+')) {
        return new Response(null, { status: 400 });
      }
      if (!isAggregation(sort.slice(1))) {
        return new Response(null, { status: 400 });
      }

      options.sort = sort as SortQuery<Aggregation>;
    }

    const aggregations: AggregationQuery = { '*': 'count' };
    for (const aggregationOption of searchParams.getAll('aggregate')) {
      const separator = aggregationOption.lastIndexOf(':');
      const field = aggregationOption.slice(0, separator);
      const operations = aggregationOption.slice(separator + 1).split(',');

      if (operations.length === 0 || !operations.every(isAggregation)) {
        return new Response(null, { status: 400 });
      }

      aggregations[field] = operations;
    }

    const result = await aggregateChallenges(
      query,
      aggregations,
      options,
      groupings,
    );
    if (result === null) {
      return new Response(null, { status: 404 });
    }

    return Response.json(result);
  },
);
