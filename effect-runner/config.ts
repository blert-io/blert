export interface Config {
  databaseUri: string;
  redisUri: string;
  /** Blert base URL for links in outgoing messages. */
  baseUrl: string;
  /** Discord webhook to which records are announced. */
  recordsWebhookUrl: string | null;
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
    baseUrl: requireString('BLERT_BASE_URL'),
    recordsWebhookUrl: optionalString('BLERT_DISCORD_RECORDS_WEBHOOK_URL'),
    port: positiveInt('PORT', DEFAULT_PORT),
    pollIntervalMs: positiveInt(
      'BLERT_EFFECT_POLL_INTERVAL_MS',
      DEFAULT_POLL_INTERVAL_MS,
    ),
  };
}

function optionalString(name: string): string | null {
  const value = process.env[name];
  return value === undefined || value === '' ? null : value;
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
