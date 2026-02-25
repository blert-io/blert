import { NextRequest } from 'next/server';

import { InvalidQueryError } from '@/actions/errors';
import logger, { runWithLogContext } from '@/utils/log';
import { observeHttpRequest } from '@/utils/metrics';

type RouteHandlerContext = {
  params?: Promise<Record<string, string | string[] | undefined>>;
};

type HandlerContext = {
  params: Promise<Record<string, string>>;
};

type ApiRouteOptions = {
  /** The route template, e.g. '/api/v1/players/[username]'. */
  route: string;
};

const NO_PARAMS = Promise.resolve({} as Record<string, string>);

export function withApiRoute(
  options: ApiRouteOptions,
  handler: (req: NextRequest, ctx: HandlerContext) => Promise<Response>,
): (req: NextRequest, ctx?: RouteHandlerContext) => Promise<Response> {
  return async (request, context) => {
    const start = process.hrtime.bigint();
    const method = request.method;

    const ctx: HandlerContext = {
      params: (context?.params ?? NO_PARAMS) as Promise<Record<string, string>>,
    };

    return runWithLogContext({ route: options.route, method }, async () => {
      let response: Response;
      try {
        response = await handler(request, ctx);
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
      }

      const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
      observeHttpRequest(options.route, method, response.status, durationMs);

      return response;
    }) as Promise<Response>;
  };
}
