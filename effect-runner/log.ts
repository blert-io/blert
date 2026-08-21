import winston from 'winston';

const env = process.env.NODE_ENV ?? 'development';
const isDev = env !== 'production';
const isTest = env === 'test';

const structuredLogsEnabled = (() => {
  const flag = process.env.BLERT_STRUCTURED_LOGS;
  if (flag === undefined) {
    return false;
  }
  return flag === '1' || flag.toLowerCase() === 'true';
})();

const usePrettyFormatter = isDev && !structuredLogsEnabled;

const logger = winston.createLogger({
  level: process.env.BLERT_LOG_LEVEL ?? (isDev ? 'debug' : 'info'),
  defaultMeta: { service: 'effect-runner' },
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    usePrettyFormatter
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
  transports: [
    new winston.transports.Console({
      silent: isTest,
    }),
  ],
});

export default logger;
