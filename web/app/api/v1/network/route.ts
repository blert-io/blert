import { ChallengeMode, ChallengeType } from '@blert/common';
import { NextRequest } from 'next/server';

import { loadPlayerNetwork, PlayerNetworkOptions } from '@/actions/challenge';
import { InvalidQueryError } from '@/actions/errors';
import { cachedRaw } from '@/api/cache';
import { withApiRoute } from '@/api/handler';
import { dateParam, numericListParam, numericParam } from '@/api/query';
import { clamp } from '@/utils/math';
import { MS_PER_DAY } from '@/utils/time';
import { NextSearchParams } from '@/utils/url';

/**
 * The limit is applied after the pair aggregation, so it bounds the size of the
 * response rather than the cost of the query. Capping it stops a single request
 * from serializing the entire pair table.
 */
const DEFAULT_LIMIT = 10_000;
const MAX_LIMIT = 10_000;

const DEFAULT_MIN_CONNECTIONS = 5;
const MIN_CONNECTIONS_FLOOR = 2;
const MIN_CONNECTIONS_CAP = 1_000;

const VALID_SCALES = new Set([1, 2, 3, 4, 5]);

// Network pairs are bucketed by UTC date so cache keys are truncated to days.
const EARLIEST_DAY = Date.UTC(2024, 0, 1);

const CACHE_TTL_SEC = 4 * 60 * 60;

const RESPONSE_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': `public, max-age=${CACHE_TTL_SEC}, stale-while-revalidate=86400`,
};

/** Network options with defaults resolved, so that cache keys are canonical. */
type ResolvedNetworkOptions = PlayerNetworkOptions & {
  limit: number;
  minChallengesTogether: number;
};

function isValidEnumValue(enumObject: object, value: number): boolean {
  return Object.values(enumObject).includes(value);
}

/** Truncates a timestamp to UTC midnight. */
function normalizeDay(timestamp: number, latest: number): Date {
  const clamped = clamp(timestamp, EARLIEST_DAY, latest);
  return new Date(Math.floor(clamped / MS_PER_DAY) * MS_PER_DAY);
}

/**
 * Parses the network filters from a request's query parameters, bounding each
 * to a range the graph query can serve cheaply.
 *
 * @param params The request's search parameters.
 * @returns The filters to load, with defaults applied.
 * @throws InvalidQueryError If a parameter is malformed or out of range.
 */
function parseNetworkOptions(params: NextSearchParams): ResolvedNetworkOptions {
  const type = numericParam<ChallengeType>(params, 'type');
  if (type !== undefined && !isValidEnumValue(ChallengeType, type)) {
    throw new InvalidQueryError(`type: Invalid challenge type ${type}`);
  }

  const mode = numericParam<ChallengeMode>(params, 'mode');
  if (mode !== undefined && !isValidEnumValue(ChallengeMode, mode)) {
    throw new InvalidQueryError(`mode: Invalid challenge mode ${mode}`);
  }

  const requestedScales = numericListParam(params, 'scale');
  let scale: number[] | undefined;
  if (requestedScales !== undefined) {
    if (requestedScales.length === 0) {
      throw new InvalidQueryError('scale: Expected at least one team size');
    }
    if (requestedScales.some((s) => !VALID_SCALES.has(s))) {
      throw new InvalidQueryError('scale: Invalid team size');
    }
    scale = Array.from(new Set(requestedScales)).sort((a, b) => a - b);
  }

  const latestDay = Math.floor(Date.now() / MS_PER_DAY) * MS_PER_DAY;
  const requestedFrom = dateParam(params, 'from');
  const requestedTo = dateParam(params, 'to');
  const from =
    requestedFrom === undefined
      ? undefined
      : normalizeDay(requestedFrom.getTime(), latestDay);
  const to =
    requestedTo === undefined
      ? undefined
      : normalizeDay(requestedTo.getTime(), latestDay);
  if (from !== undefined && to !== undefined && from > to) {
    throw new InvalidQueryError('from: Range starts after it ends');
  }

  const limit = numericParam(params, 'limit');
  const minConnections = numericParam(params, 'minConnections');

  return {
    type,
    mode,
    scale,
    from,
    to,
    limit: limit === undefined ? DEFAULT_LIMIT : clamp(limit, 1, MAX_LIMIT),
    minChallengesTogether:
      minConnections === undefined
        ? DEFAULT_MIN_CONNECTIONS
        : clamp(minConnections, MIN_CONNECTIONS_FLOOR, MIN_CONNECTIONS_CAP),
  };
}

function cacheKey(options: ResolvedNetworkOptions): string {
  const key = new URLSearchParams({
    limit: options.limit.toString(),
    minConnections: options.minChallengesTogether.toString(),
  });

  if (options.type !== undefined) {
    key.set('type', options.type.toString());
  }
  if (options.mode !== undefined) {
    key.set('mode', options.mode.toString());
  }
  if (options.scale !== undefined) {
    key.set('scale', options.scale.join(','));
  }
  if (options.from !== undefined) {
    key.set('from', options.from.toISOString().slice(0, 10));
  }
  if (options.to !== undefined) {
    key.set('to', options.to.toISOString().slice(0, 10));
  }

  key.sort();
  return key.toString();
}

const cachedLoadPlayerNetwork = cachedRaw(
  { name: 'network', ttlSec: CACHE_TTL_SEC },
  (_options: ResolvedNetworkOptions, key: string) => key,
  (options: ResolvedNetworkOptions, _key: string) => loadPlayerNetwork(options),
);

export const GET = withApiRoute(
  { route: '/api/v1/network' },
  async (request: NextRequest) => {
    const options = parseNetworkOptions(
      Object.fromEntries(request.nextUrl.searchParams),
    );
    const body = await cachedLoadPlayerNetwork(options, cacheKey(options));
    return new Response(body, { headers: RESPONSE_HEADERS });
  },
);
