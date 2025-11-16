import type { Request, Response, NextFunction } from 'express';
import { ApiError, ApiErrorCode } from './error';

const SERVICE_TOKEN = process.env.BLERTBANK_SERVICE_TOKEN;
if (!SERVICE_TOKEN) {
  throw new Error('BLERTBANK_SERVICE_TOKEN is not set');
}

export function requireServiceAuth(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const headerToken =
    req.header('X-Service-Token') ??
    (req.header('authorization') ?? '').replace(/^Bearer\s+/i, '');

  if (!headerToken || headerToken !== SERVICE_TOKEN) {
    return next(
      new ApiError(ApiErrorCode.UNAUTHORIZED, 'Unauthorized service request'),
    );
  }

  // TODO(frolv): Include service name in structured logs.
  res.locals.serviceName = req.header('X-Service-Name') ?? 'unknown';

  return next();
}
