import {
  collectDefaultMetrics,
  Counter,
  Histogram,
  Registry,
} from 'prom-client';

const register = new Registry();
collectDefaultMetrics({ register });

function sanitizeLabel(
  value: string | null | undefined,
  fallback = 'unknown',
): string {
  return value?.slice(0, 64) ?? fallback;
}

const httpRequestCounter = new Counter({
  name: 'web_http_requests_total',
  help: 'HTTP request results',
  labelNames: ['route', 'method', 'status'] as const,
  registers: [register],
});

const httpRequestDuration = new Histogram({
  name: 'web_http_request_duration_ms',
  help: 'HTTP request latency in milliseconds',
  labelNames: ['route', 'method', 'status'] as const,
  buckets: [5, 15, 30, 60, 120, 250, 500, 1_000, 2_000, 5_000, 10_000],
  registers: [register],
});

export function observeHttpRequest(
  route: string,
  method: string,
  status: number,
  durationMs: number,
): void {
  const labels = {
    route: sanitizeLabel(route),
    method: method.toUpperCase(),
    status: status.toString(),
  };
  httpRequestCounter.inc(labels);
  httpRequestDuration.observe(labels, durationMs);
}

const serverActionCounter = new Counter({
  name: 'web_server_action_total',
  help: 'Server action invocations',
  labelNames: ['action', 'result'] as const,
  registers: [register],
});

const serverActionDuration = new Histogram({
  name: 'web_server_action_duration_ms',
  help: 'Server action latency in milliseconds',
  labelNames: ['action', 'result'] as const,
  buckets: [5, 15, 30, 60, 120, 250, 500, 1_000, 2_000, 5_000, 10_000],
  registers: [register],
});

export function observeServerAction(
  action: string,
  result: 'success' | 'error',
  durationMs: number,
): void {
  const labels = { action: sanitizeLabel(action), result };
  serverActionCounter.inc(labels);
  serverActionDuration.observe(labels, durationMs);
}

export async function withServerAction<T>(
  action: string,
  fn: () => Promise<T>,
): Promise<T> {
  const start = process.hrtime.bigint();
  let result: 'success' | 'error' = 'success';
  try {
    return await fn();
  } catch (e) {
    result = 'error';
    throw e;
  } finally {
    const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    observeServerAction(action, result, durationMs);
  }
}

const redisEventsCounter = new Counter({
  name: 'web_redis_events_total',
  help: 'Redis client events',
  labelNames: ['type'] as const,
  registers: [register],
});

export function recordRedisEvent(type: 'connect' | 'error'): void {
  redisEventsCounter.inc({ type });
}

const emailSendCounter = new Counter({
  name: 'web_email_send_total',
  help: 'Email send attempts',
  labelNames: ['type', 'result'] as const,
  registers: [register],
});

export function recordEmailSend(
  type: string,
  result: 'success' | 'error',
): void {
  emailSendCounter.inc({ type: sanitizeLabel(type), result });
}

export const metricsContentType = register.contentType;

export const getMetricsSnapshot = (): Promise<string> => register.metrics();
