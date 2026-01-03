import { ChallengeType, RecordingType } from '@blert/common';
import {
  collectDefaultMetrics,
  Counter,
  Gauge,
  Histogram,
  Registry,
} from 'prom-client';

import { MessageFormat } from './protocol';

const register = new Registry();
collectDefaultMetrics({ register });

type Direction = 'in' | 'out';
type OperationResult = 'success' | 'error';

export type RemoteOperation =
  | 'start'
  | 'update'
  | 'complete'
  | 'process_events'
  | 'join';

export type AuthFailureReason =
  | 'missing_token'
  | 'invalid_token'
  | 'missing_plugin_versions'
  | 'plugin_not_allowed'
  | 'unknown';

const AUTH_NO_REASON = 'none';

export type ChallengeStartResult =
  | 'started'
  | 'error'
  | 'blocked'
  | 'missing_linked_player'
  | 'invalid_party_size'
  | 'unimplemented'
  | 'unknown';

export type ChallengeEndResult = 'success' | 'error';

export type ChallengeUpdateResult = 'success' | 'error' | 'wrong_challenge';

function sanitizeLabel(
  value: string | null | undefined,
  fallback = 'unknown',
): string {
  return value?.slice(0, 64) ?? fallback;
}

const authAttempts = new Counter({
  name: 'socket_server_auth_attempts_total',
  help: 'WebSocket authentication attempts',
  labelNames: ['result', 'reason'] as const,
  registers: [register],
});

const connectionsTotal = new Counter({
  name: 'socket_server_connections_total',
  help: 'Total client connections accepted',
  labelNames: ['plugin_version', 'runelite_version'] as const,
  registers: [register],
});

const activeClients = new Gauge({
  name: 'socket_server_active_clients',
  help: 'Number of currently connected clients',
  registers: [register],
});

const disconnectionsTotal = new Counter({
  name: 'socket_server_disconnections_total',
  help: 'Client disconnections by reason',
  labelNames: ['reason', 'code'] as const,
  registers: [register],
});

const messageBytes = new Histogram({
  name: 'socket_server_message_bytes',
  help: 'Distribution of socket message sizes',
  labelNames: ['direction', 'format'] as const,
  buckets: [16, 64, 256, 1_024, 4_096, 16_384, 65_536, 262_144],
  registers: [register],
});

const messageCount = new Counter({
  name: 'socket_server_message_count_total',
  help: 'Number of socket messages processed',
  labelNames: ['direction', 'format'] as const,
  registers: [register],
});

const invalidMessages = new Counter({
  name: 'socket_server_invalid_messages_total',
  help: 'Invalid messages received',
  labelNames: ['type'] as const,
  registers: [register],
});

const challengeStartCounter = new Counter({
  name: 'socket_server_challenge_start_total',
  help: 'Challenge start attempts',
  labelNames: ['challenge_type', 'recording_type', 'result'] as const,
  registers: [register],
});

const challengeEndCounter = new Counter({
  name: 'socket_server_challenge_end_total',
  help: 'Challenge end attempts',
  labelNames: ['result'] as const,
  registers: [register],
});

const challengeUpdateCounter = new Counter({
  name: 'socket_server_challenge_update_total',
  help: 'Challenge update processing results',
  labelNames: ['result'] as const,
  registers: [register],
});

const eventStreamCounter = new Counter({
  name: 'socket_server_event_stream_batches_total',
  help: 'Event stream batches processed',
  labelNames: ['result'] as const,
  registers: [register],
});

const redisEventsCounter = new Counter({
  name: 'socket_server_redis_events_total',
  help: 'Redis client events',
  labelNames: ['type'] as const,
  registers: [register],
});

const remoteOpsCounter = new Counter({
  name: 'socket_server_remote_ops_total',
  help: 'Challenge server operations',
  labelNames: ['operation', 'result'] as const,
  registers: [register],
});

const remoteOpDuration = new Histogram({
  name: 'socket_server_remote_op_duration_seconds',
  help: 'Time spent waiting on challenge server operations',
  labelNames: ['operation', 'result'] as const,
  buckets: [0.01, 0.025, 0.05, 0.075, 0.1, 0.2, 0.3, 0.5, 1, 2, 3, 5, 10],
  registers: [register],
});

const serverStatusGauge = new Gauge({
  name: 'socket_server_status_state',
  help: 'Server status value (1 when current status matches label)',
  labelNames: ['status'] as const,
  registers: [register],
});

const shutdownBroadcastsCounter = new Counter({
  name: 'socket_server_shutdown_broadcasts_total',
  help: 'Server status broadcasts',
  labelNames: ['status'] as const,
  registers: [register],
});

const SERVER_STATUSES = [
  'RUNNING',
  'SHUTDOWN_PENDING',
  'SHUTDOWN_CANCELED',
  'SHUTDOWN_IMMINENT',
  'OFFLINE',
] as const;

SERVER_STATUSES.forEach((status) => serverStatusGauge.labels(status).set(0));

export const metricsContentType = register.contentType;

export const getMetricsSnapshot = (): Promise<string> => register.metrics();

export const recordAuthSuccess = (): void => {
  authAttempts.inc({ result: 'success', reason: AUTH_NO_REASON });
};

export const recordAuthFailure = (reason: AuthFailureReason): void => {
  authAttempts.inc({ result: 'failure', reason });
};

type ClientMetadata = {
  pluginVersion: string;
  runeLiteVersion: string;
};

export const recordClientRegistration = ({
  pluginVersion,
  runeLiteVersion,
}: ClientMetadata): void => {
  connectionsTotal.inc({
    plugin_version: sanitizeLabel(pluginVersion),
    runelite_version: sanitizeLabel(runeLiteVersion),
  });
};

export const recordActiveClients = (count: number): void => {
  activeClients.set(count);
};

export const recordClientDisconnection = (
  reason: string,
  code?: number,
): void => {
  disconnectionsTotal.inc({
    reason: sanitizeLabel(reason, 'unknown'),
    code: sanitizeLabel(code !== undefined ? String(code) : 'none'),
  });
};

export const observeMessageBytes = (
  direction: Direction,
  format: MessageFormat,
  size: number,
): void => {
  messageBytes.observe({ direction, format }, size);
  messageCount.inc({ direction, format });
};

export type InvalidMessageType =
  | 'protobuf'
  | 'text'
  | 'json_syntax'
  | 'json_schema'
  | 'json_conversion'
  | 'unexpected_binary';

export const recordInvalidMessage = (type: InvalidMessageType): void => {
  invalidMessages.inc({ type });
};

export const recordChallengeStart = (
  challengeType: ChallengeType,
  recordingType: RecordingType,
  result: ChallengeStartResult,
): void => {
  challengeStartCounter.inc({
    challenge_type: sanitizeLabel(ChallengeType[challengeType]),
    recording_type: sanitizeLabel(RecordingType[recordingType]),
    result: sanitizeLabel(result),
  });
};

export const recordChallengeEnd = (result: ChallengeEndResult): void => {
  challengeEndCounter.inc({
    result: sanitizeLabel(result),
  });
};

export const recordChallengeUpdate = (result: ChallengeUpdateResult): void => {
  challengeUpdateCounter.inc({ result: sanitizeLabel(result) });
};

export const recordEventStreamBatch = (result: OperationResult): void => {
  eventStreamCounter.inc({ result });
};

export const recordRedisEvent = (type: 'connect' | 'error'): void => {
  redisEventsCounter.inc({ type });
};

export const recordRemoteOperation = (
  operation: RemoteOperation,
  result: OperationResult,
): void => {
  remoteOpsCounter.inc({ operation, result });
};

type ServerStatus = (typeof SERVER_STATUSES)[number];

export const setServerStatusMetric = (status: ServerStatus): void => {
  SERVER_STATUSES.forEach((knownStatus) => {
    serverStatusGauge.labels(knownStatus).set(knownStatus === status ? 1 : 0);
  });
};

export const recordShutdownBroadcast = (status: ServerStatus): void => {
  shutdownBroadcastsCounter.inc({ status });
};

export async function timeRemoteOperation<T>(
  operation: RemoteOperation,
  fn: () => T | Promise<T>,
): Promise<T> {
  const start = process.hrtime.bigint();
  try {
    const result = await fn();
    observeRemoteDuration(operation, 'success', start);
    return result;
  } catch (error) {
    observeRemoteDuration(operation, 'error', start);
    throw error;
  }
}

function observeRemoteDuration(
  operation: RemoteOperation,
  result: OperationResult,
  startedAt: bigint,
): void {
  const durationSeconds =
    Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;
  remoteOpDuration.observe({ operation, result }, durationSeconds);
}
