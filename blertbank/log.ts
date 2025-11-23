import { Request, Response, NextFunction } from 'express';
import winston from 'winston';

import { getRequestContext } from './context';

const isDev = process.env.NODE_ENV === 'development';

/**
 * Custom Winston format that merges request context into every log entry.
 * This allows logs emitted during a request to include caller service name,
 * request ID, and other contextual metadata automatically.
 */
const requestContextFormat = winston.format((info) => {
  const ctx = getRequestContext();
  if (ctx.requestService !== undefined) {
    info.callerService = ctx.requestService;
  }
  if (ctx.requestId !== undefined) {
    info.requestId = ctx.requestId;
  }
  return info;
});

const logger = winston.createLogger({
  level:
    process.env.BLERTBANK_LOG_LEVEL ??
    process.env.BLERT_LOG_LEVEL ??
    (isDev ? 'debug' : 'info'),
  defaultMeta: { service: 'blertbank' },
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    requestContextFormat(),
    isDev
      ? winston.format.printf((info) => {
          const { timestamp, level, message, service, ...meta } = info;
          const metaStr =
            meta && Object.keys(meta).length > 0
              ? ' ' + JSON.stringify(meta)
              : '';
          return `${String(timestamp)} [${String(service)}] ${String(level)}: ${String(message)}${metaStr}`;
        })
      : winston.format.json(),
  ),
  transports: [new winston.transports.Console()],
});

export default logger;

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const diff = process.hrtime.bigint() - start;
    const durationMs = Number(diff) / 1e6;

    logger.info('http_request_completed', {
      event: 'http_request_completed',
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs,
      userAgent: req.get('user-agent'),
    });
  });

  next();
}
