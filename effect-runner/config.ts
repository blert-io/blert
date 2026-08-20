export interface Config {
  databaseUri: string;
  redisUri: string;
  port: number;
  /** Delay between polls of the effect event outbox, in milliseconds. */
  pollIntervalMs: number;
}

const DEFAULT_PORT = 3003;
const DEFAULT_POLL_INTERVAL_MS = 2000;

/**
 * Reads the effect runner's configuration from environment variables.
 * @returns The parsed configuration.
 * @throws Error if a required variable is missing or a value is invalid.
 */
export function loadConfig(): Config {
  return {
    databaseUri: requireString('BLERT_DATABASE_URI'),
    redisUri: requireString('BLERT_REDIS_URI'),
    port: positiveInt('PORT', DEFAULT_PORT),
    pollIntervalMs: positiveInt(
      'BLERT_EFFECT_POLL_INTERVAL_MS',
      DEFAULT_POLL_INTERVAL_MS,
    ),
  };
}

function requireString(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`${name} must be set`);
  }
  return value;
}

function positiveInt(name: string, defaultValue: number): number {
  const value = process.env[name];
  if (value === undefined || value === '') {
    return defaultValue;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}
