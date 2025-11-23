import { AsyncLocalStorage } from 'async_hooks';
import type { Request, Response, NextFunction } from 'express';

/**
 * Request-scoped context that propagates through async operations.
 * Used to include contextual metadata in all logs emitted during a request's
 * lifecycle.
 */
export interface RequestContext {
  /** Name of the service making the request (from X-Service-Name header). */
  requestService?: string;
  /** Request correlation ID for distributed tracing. */
  requestId?: string;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

/**
 * Returns the current request context, or an empty object if none is set.
 */
export function getRequestContext(): RequestContext {
  return requestContext.getStore() ?? {};
}

/**
 * Updates the current request context with additional fields.
 * No-op if called outside of a request context.
 */
export function updateRequestContext(updates: Partial<RequestContext>): void {
  const store = requestContext.getStore();
  if (store !== undefined) {
    Object.assign(store, updates);
  }
}

/**
 * Middleware that initializes the request context for all downstream handlers.
 * Extracts request ID from standard headers if present.
 */
export function contextMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  const ctx: RequestContext = {
    requestId:
      (req.headers['x-request-id'] as string | undefined) ??
      (req.headers['x-correlation-id'] as string | undefined),
  };

  requestContext.run(ctx, () => next());
}
