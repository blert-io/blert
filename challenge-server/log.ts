import winston from 'winston';

const logger = winston.createLogger({
  level: process.env.BLERT_LOG_LEVEL ?? 'info',
  format: winston.format.combine(
    winston.format.splat(),
    winston.format.timestamp(),
    winston.format.json(),
    winston.format.printf(({ timestamp, level, message, service }) => {
      return `${timestamp} [${service}] ${level}: ${message}`;
    }),
  ),
  defaultMeta: { service: 'challenge-server' },
  transports: [
    new winston.transports.Console({
      format: winston.format.cli(),
    }),
  ],
});
export default logger;
