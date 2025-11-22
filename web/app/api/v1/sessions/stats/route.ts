import { NextRequest } from 'next/server';

import { isAggregation } from '@/api/query';
import {
  aggregateSessions,
  Aggregation,
  AggregationQuery,
  SessionAggregationOptions,
  SortQuery,
} from '@/actions/challenge';

import { parseSessionQueryParams } from '../query';

export async function GET(request: NextRequest) {
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
    const sort = searchParams.get('sort')!;
    if (!sort.startsWith('-') && !sort.startsWith('+')) {
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

  const groupings = (searchParams.get('group') ?? '')
    .split(',')
    .filter((g) => g !== '');

  try {
    const query = parseSessionQueryParams(searchParams);
    const result = await aggregateSessions(
      query,
      aggregations,
      options,
      groupings,
    );
    return Response.json(result);
  } catch (e) {
    if (e instanceof Error && e.name === 'InvalidQueryError') {
      return new Response(null, { status: 400 });
    }

    console.error('Failed to load sessions:', e);
    return new Response(null, { status: 500 });
  }
}
