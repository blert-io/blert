import { NextRequest } from 'next/server';

import { InvalidQueryError } from '@/actions/errors';
import { getTrustedRequestIp } from '@/utils/headers';
import logger, { runWithLogContext } from '@/utils/log';
import { observeHttpRequest } from '@/utils/metrics';
import { acquireConcurrencySlot } from '@/utils/rate-limit';
import { requestParams } from '@/utils/url';

type RouteHandlerContext = {
  params?: Promise<Record<string, string | string[] | undefined>>;
};

type HandlerContext = {
  params: Promise<Record<string, string>>;
};

// TODO(frolv): Move into a table shared with proxy.ts's rate limits, matched
// by path, instead of routes opting in.
/** Most requests one client IP can have in flight in each group. */
const CONCURRENCY_LIMITS = {
  stats: 16,
} as const;

const CONCURRENCY_MAX_HOLD_SEC = 60;

type ConcurrencyGroup = keyof typeof CONCURRENCY_LIMITS;

type ApiRouteOptions = {
  /** The route template, e.g. '/api/v1/players/[username]'. */
  route: string;
  /** Group whose in-flight limit the route's requests count toward. */
  concurrencyGroup?: ConcurrencyGroup;
};

const SLOW_REQUEST_THRESHOLD_MS = parseInt(
  process.env.BLERT_SLOW_REQUEST_THRESHOLD_MS ?? '500',
  10,
);

const NO_PARAMS = Promise.resolve({} as Record<string, string>);

const NO_SLOT = () => {
  /* noop */
};

async function acquireSlot(
  request: NextRequest,
  group: ConcurrencyGroup | undefined,
): Promise<(() => void) | null> {
  if (group === undefined) {
    return NO_SLOT;
  }
  const ip = getTrustedRequestIp(request.headers);
  if (ip === null) {
    return NO_SLOT;
  }
  return acquireConcurrencySlot(
    `concurrency:${group}:ip:${ip}`,
    CONCURRENCY_LIMITS[group],
    CONCURRENCY_MAX_HOLD_SEC,
  );
}

export function withApiRoute(
  options: ApiRouteOptions,
  handler: (req: NextRequest, ctx: HandlerContext) => Promise<Response>,
): (req: NextRequest, ctx?: RouteHandlerContext) => Promise<Response> {
  return async (request, context) => {
    const start = process.hrtime.bigint();
    const route = request.nextUrl.pathname;
    const params = requestParams(request.nextUrl.searchParams);
    const method = request.method;

    const ctx: HandlerContext = {
      params: (context?.params ?? NO_PARAMS) as Promise<Record<string, string>>,
    };

    return runWithLogContext({ route: options.route, method }, async () => {
      let response: Response;
      const release = await acquireSlot(request, options.concurrencyGroup);
      try {
        if (release === null) {
          response = Response.json(
            {
              error: 'too_many_concurrent_requests',
              message: 'Too many requests in progress, please try again later.',
            },
            { status: 429 },
          );
        } else {
          response = await handler(request, ctx);
        }
      } catch (error) {
        if (error instanceof InvalidQueryError) {
          response = Response.json({ error: error.message }, { status: 400 });
        } else {
          logger.error('unhandled_api_error', {
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
          });
          response = new Response(null, { status: 500 });
        }
      } finally {
        release?.();
      }

      const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
      observeHttpRequest(options.route, method, response.status, durationMs);

      if (durationMs > SLOW_REQUEST_THRESHOLD_MS) {
        logger.warn('slow_api_request', {
          route,
          params,
          method,
          durationMs,
        });
      }

      return response;
    });
  };
}
