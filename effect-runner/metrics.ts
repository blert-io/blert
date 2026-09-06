import http from 'node:http';

import {
  collectDefaultMetrics,
  Counter,
  Gauge,
  Histogram,
  Registry,
} from 'prom-client';

import logger from './log';

const register = new Registry();
collectDefaultMetrics({ register });

const oldestOutstandingEventAge = new Gauge({
  name: 'effect_runner_oldest_outstanding_event_age_ms',
  help: 'Age of the oldest event with outstanding work',
  registers: [register],
});

const deliveryAttempts = new Counter({
  name: 'effect_runner_delivery_attempts_total',
  help: 'Delivery attempts by outcome',
  labelNames: ['handler', 'outcome'] as const,
  registers: [register],
});

const deliveryFailures = new Counter({
  name: 'effect_runner_failures_total',
  help: 'Deliveries which exhausted their attempts or failed outright',
  labelNames: ['handler'] as const,
  registers: [register],
});

const planErrors = new Counter({
  name: 'effect_runner_plan_errors_total',
  help: 'Errors occurring in handler plan functions',
  labelNames: ['handler'] as const,
  registers: [register],
});

const deliveryLatency = new Histogram({
  name: 'effect_runner_delivery_latency_ms',
  help: 'Time from event creation to delivery',
  labelNames: ['handler'] as const,
  buckets: [1_000, 2_500, 5_000, 15_000, 60_000, 300_000, 1_800_000, 7_200_000],
  registers: [register],
});

const polls = new Counter({
  name: 'effect_runner_poll_total',
  help: 'Completed poll loop iterations',
  registers: [register],
});

const pollErrors = new Counter({
  name: 'effect_runner_poll_errors_total',
  help: 'Number of failed poll iterations',
  registers: [register],
});

const pollDuration = new Histogram({
  name: 'effect_runner_poll_duration_ms',
  help: 'Poll loop iteration duration',
  buckets: [5, 15, 30, 60, 120, 250, 500, 1_000, 2_000, 5_000, 10_000],
  registers: [register],
});

export type AttemptOutcomeLabel =
  'delivered' | 'skipped' | 'failed' | 'retry' | 'error';

/** Records the age of the oldest event with outstanding work. */
export function setOldestOutstandingEventAge(ageMs: number): void {
  oldestOutstandingEventAge.set(ageMs);
}

/** Counts one delivery attempt. */
export function recordDeliveryAttempt(
  handler: string,
  outcome: AttemptOutcomeLabel,
): void {
  deliveryAttempts.inc({ handler, outcome });
}

/** Counts a delivery reaching the `failed` status. */
export function recordDeliveryFailure(handler: string): void {
  deliveryFailures.inc({ handler });
}

/** Counts an error occurring in a handler's `plan`. */
export function recordPlanError(handler: string): void {
  planErrors.inc({ handler });
}

/** Records the time from an event's creation to its delivery. */
export function observeDeliveryLatency(
  handler: string,
  latencyMs: number,
): void {
  deliveryLatency.observe({ handler }, latencyMs);
}

/** Counts a completed poll loop iteration and its duration. */
export function observePoll(durationMs: number): void {
  polls.inc();
  pollDuration.observe(durationMs);
}

/** Counts a failed poll iteration. */
export function recordPollError(): void {
  pollErrors.inc();
}

/**
 * Starts an HTTP server for Prometheus metrics.
 * @param port Port to listen on.
 * @returns The running server.
 */
export function startMetricsListener(port: number): http.Server {
  const server = http.createServer((req, res) => {
    void handleRequest(req, res);
  });
  server.listen(port, () => logger.info('metrics_listener_started', { port }));
  return server;
}

async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  if (req.method !== 'GET') {
    res.writeHead(405).end();
    return;
  }

  const path = req.url?.split('?', 1)[0];
  if (path !== '/metrics') {
    res.writeHead(404).end();
    return;
  }

  try {
    const metrics = await register.metrics();
    res.writeHead(200, { 'Content-Type': register.contentType });
    res.end(metrics);
  } catch (e) {
    logger.error('metrics_collection_failed', {
      error: e instanceof Error ? e.message : String(e),
    });
    res.writeHead(500).end();
  }
}
