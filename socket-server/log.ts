import { AsyncLocalStorage } from 'node:async_hooks';
import winston from 'winston';

const isDev = process.env.NODE_ENV !== 'production';

const addContext = winston.format((info) => {
  const context = getLogContext();
  if (context) {
    for (const [key, value] of Object.entries(context)) {
      info[key] ??= value;
    }
  }
  return info;
});

const logger = winston.createLogger({
  level: process.env.BLERT_LOG_LEVEL ?? (isDev ? 'debug' : 'info'),
  defaultMeta: { service: 'socket-server' },
  format: winston.format.combine(
    addContext(),
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    isDev
      ? winston.format.printf((info) => {
          const { timestamp, level, message, service, context, ...meta } = info;
          const mergedMeta = { ...(context ?? {}), ...meta };
          const metaStr =
            mergedMeta && Object.keys(mergedMeta).length > 0
              ? ' ' + JSON.stringify(mergedMeta)
              : '';
          return `${String(timestamp)} [${String(service)}] ${String(level)}: ${String(message)}${metaStr}`;
        })
      : winston.format.json(),
  ),
  transports: [new winston.transports.Console()],
});

export default logger;

export type LogContext = Record<string, unknown>;

const storage = new AsyncLocalStorage<LogContext>();

export function runWithLogContext<T>(
  context: LogContext,
  fn: () => Promise<T> | T,
): Promise<T> | T {
  const current = storage.getStore() ?? {};
  const merged = { ...current, ...context };
  return storage.run(merged, fn);
}

export function getLogContext(): LogContext | undefined {
  return storage.getStore();
}
