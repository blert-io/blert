import { Application, NextFunction, Request, Response } from 'express';

import logger from '@/log';

import * as accounts from './accounts';
import { requireServiceAuth } from './auth';
import { ApiError, ApiErrorCode } from './error';
import * as health from './health';
import * as transactions from './transactions';

type ErrorResponse = {
  error: ApiErrorCode;
  message: string;
  details?: Record<string, unknown>;
  timestamp: string;
};

export function apiErrorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  let response: ErrorResponse;
  let statusCode: number;

  if (err instanceof ApiError) {
    statusCode = err.statusCode;
    response = {
      error: err.code,
      message: err.message,
      timestamp: new Date().toISOString(),
    };
  } else {
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;

    logger.error('api_unhandled_error', {
      event: 'api_unhandled_error',
      message: msg,
      stack,
    });

    statusCode = 500;
    response = {
      error: ApiErrorCode.INTERNAL_ERROR,
      message: 'An unexpected error occurred',
      timestamp: new Date().toISOString(),
    };
  }

  res.status(statusCode).json(response);
}

function asyncHandler(
  fn: (req: Request, res: Response) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return function (req: Request, res: Response, next: NextFunction) {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

export function registerApiRoutes(app: Application): void {
  app.get('/ping', health.ping);
  app.get('/health', asyncHandler(health.getHealth));

  app.use(requireServiceAuth);

  app.post('/accounts', asyncHandler(accounts.createForUser));
  app.get('/accounts/user/:userId', asyncHandler(accounts.getByUserId));

  app.post('/transactions', asyncHandler(transactions.create));
}
