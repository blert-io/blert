import { Request, Response, NextFunction } from 'express';
import winston from 'winston';

const isDev = process.env.NODE_ENV === 'development';

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
      requestId:
        (req.headers['x-request-id'] as string | undefined) ??
        (req.headers['x-correlation-id'] as string | undefined) ??
        undefined,
    });
  });

  next();
}
