import {
  ChallengeMode,
  ChallengeStatus,
  ChallengeType,
  isColosseumStage,
  isCoxStage,
  isInfernoStage,
  isMokhaiotlStage,
  isToaStage,
  isTobStage,
  RecordingType,
  Stage,
  StageStatus,
} from '@blert/common';
import {
  collectDefaultMetrics,
  Counter,
  Gauge,
  Histogram,
  Registry,
} from 'prom-client';
import {
  MergeAlertType,
  MergeClientClassification,
  MergeClientStatus,
} from './merging/merge';
import { ClientAnomaly } from './merging/client-events';

const register = new Registry();
collectDefaultMetrics({ register });

function boolLabel(value: boolean): 'true' | 'false' {
  return value.toString() as 'true' | 'false';
}

function enumLabel<T extends Record<string, string | number>>(
  enumObj: T,
  value: number | string,
): string {
  if (typeof value === 'number') {
    const label = enumObj[value as keyof T];
    return typeof label === 'string' ? label.toLowerCase() : value.toString();
  }
  // For string enums, pass-through to keep original casing.
  return value.toLowerCase();
}

function stageLabel(stage: Stage): string {
  // Collapse stages from solo challenges into a single label to keep
  // cardinality bounded and because most stage-based metrics exist to monitor
  // merge performance, which isn't relevant to solos.
  if (isColosseumStage(stage)) {
    return 'colosseum_any';
  }
  if (isInfernoStage(stage)) {
    return 'inferno_any';
  }
  if (isMokhaiotlStage(stage)) {
    return 'mokhaiotl_any';
  }

  if (isCoxStage(stage) || isToaStage(stage) || isTobStage(stage)) {
    return enumLabel(Stage, stage);
  }

  if (stage === Stage.UNKNOWN) {
    return 'unknown';
  }

  const _exhaustive: never = stage;
  return 'unknown';
}

function normalizeRoute(route: string): string {
  if (route.startsWith('/')) {
    return route;
  }
  return `/${route}`;
}

function normalizeMethod(method: string): string {
  return method.toUpperCase();
}

const httpRequestCounter = new Counter({
  name: 'challenge_server_http_requests_total',
  help: 'HTTP request results',
  labelNames: ['route', 'method', 'status'] as const,
  registers: [register],
});

const httpRequestDuration = new Histogram({
  name: 'challenge_server_http_request_duration_ms',
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
    route: normalizeRoute(route),
    method: normalizeMethod(method),
    status: status.toString(),
  };
  httpRequestCounter.inc(labels);
  httpRequestDuration.observe(labels, durationMs);
}

const clientEventQueueDepth = new Gauge({
  name: 'challenge_server_client_event_queue_depth',
  help: 'Depth of the client event queue',
  registers: [register],
});

const clientEventProcessed = new Counter({
  name: 'challenge_server_client_event_processed_total',
  help: 'Client event statuses processed',
  labelNames: ['status'] as const,
  registers: [register],
});

export type ClientEventStatusLabel = 'active' | 'idle' | 'disconnected';

export const setClientEventQueueDepth = (depth: number): void => {
  clientEventQueueDepth.set(depth);
};

export const incrementClientEventProcessed = (
  status: ClientEventStatusLabel,
): void => {
  clientEventProcessed.inc({ status });
};

const watchTransactionConflicts = new Counter({
  name: 'challenge_server_watch_transaction_conflicts_total',
  help: 'Redis watch transaction conflicts encountered',
  labelNames: ['action'] as const,
  registers: [register],
});

export const recordWatchConflict = (action: string): void => {
  watchTransactionConflicts.inc({ action });
};

export type ChallengeRequestAction = 'create' | 'join';
export type ChallengeRequestDecision =
  | 'accepted'
  | 'rejected'
  | 'deferred'
  | 'error';

const challengeRequests = new Counter({
  name: 'challenge_server_challenge_requests_total',
  help: 'Challenge request flow decisions',
  labelNames: ['action', 'type', 'mode', 'recording_type', 'decision'] as const,
  registers: [register],
});

export const recordChallengeRequest = (
  action: ChallengeRequestAction,
  type: ChallengeType,
  mode: ChallengeMode,
  recordingType: RecordingType,
  decision: ChallengeRequestDecision,
): void => {
  challengeRequests.inc({
    action,
    type: enumLabel(ChallengeType, type),
    mode: enumLabel(ChallengeMode, mode),
    recording_type: enumLabel(RecordingType, recordingType),
    decision,
  });
};

const clientReconnects = new Counter({
  name: 'challenge_server_client_reconnects_total',
  help: 'Client reconnects',
  labelNames: ['recording_type', 'decision'] as const,
  registers: [register],
});

export const recordClientReconnect = (
  recordingType: RecordingType,
  decision: ChallengeRequestDecision,
): void => {
  clientReconnects.inc({
    recording_type: enumLabel(RecordingType, recordingType),
    decision,
  });
};

type ChallengeLifecycleState = 'active' | 'cleanup';

const activeChallenges = new Gauge({
  name: 'challenge_server_active_challenges',
  help: 'Number of challenges tracked in Redis',
  labelNames: ['type', 'mode', 'state'] as const,
  registers: [register],
});

// TODO(frolv): Connect this via a periodic watchdog.
export const setActiveChallenges = (
  type: ChallengeType,
  mode: ChallengeMode,
  state: ChallengeLifecycleState,
  count: number,
): void => {
  const labels = {
    type: enumLabel(ChallengeType, type),
    mode: enumLabel(ChallengeMode, mode),
    state,
  };
  activeChallenges.set(labels, count);
};

export type FinishRequestResult = 'accepted' | 'rejected' | 'error';

const finishRequests = new Counter({
  name: 'challenge_server_finish_requests_total',
  help: 'Challenge finish attempt outcomes',
  labelNames: ['all_clients_done', 'result'] as const,
  registers: [register],
});

export const recordFinishRequest = (
  allClientsDone: boolean,
  result: FinishRequestResult,
): void => {
  finishRequests.inc({
    all_clients_done: boolLabel(allClientsDone),
    result,
  });
};

export type FinalizationPath = 'normal' | 'timeout' | 'forced_cleanup';

const challengeFinalization = new Counter({
  name: 'challenge_server_challenge_finalization_total',
  help: 'Challenge finalization paths',
  labelNames: ['path', 'status'] as const,
  registers: [register],
});

export const recordChallengeFinalization = (
  path: FinalizationPath,
  status: ChallengeStatus,
): void => {
  challengeFinalization.inc({
    path,
    status: enumLabel(ChallengeStatus, status),
  });
};

export type ReconnectionTimerReason = 'all_inactive' | 'disconnect';

const reconnectionTimers = new Counter({
  name: 'challenge_server_reconnection_timers_total',
  help: 'Reconnection timer scheduling reasons',
  labelNames: ['reason'] as const,
  registers: [register],
});

export const recordReconnectionTimer = (
  reason: ReconnectionTimerReason,
): void => {
  reconnectionTimers.inc({ reason });
};

const stageStarted = new Counter({
  name: 'challenge_server_stage_started_total',
  help: 'Stages started within a challenge',
  labelNames: ['type', 'mode', 'stage'] as const,
  registers: [register],
});

export const recordStageStart = (
  type: ChallengeType,
  mode: ChallengeMode,
  stage: Stage,
): void => {
  stageStarted.inc({
    type: enumLabel(ChallengeType, type),
    mode: enumLabel(ChallengeMode, mode),
    stage: stageLabel(stage),
  });
};

const stageCompleted = new Counter({
  name: 'challenge_server_stage_complete_total',
  help: 'Stage processing outcomes',
  labelNames: [
    'stage',
    'status',
    'accurate',
    'has_merge_failures',
    'has_skipped_clients',
  ] as const,
  registers: [register],
});

export const recordStageCompletion = (
  stage: Stage,
  status: StageStatus,
  accurate: boolean,
  hasMergeFailures: boolean,
  hasSkippedClients: boolean,
): void => {
  stageCompleted.inc({
    stage: stageLabel(stage),
    status: enumLabel(StageStatus, status),
    accurate: boolLabel(accurate),
    has_merge_failures: boolLabel(hasMergeFailures),
    has_skipped_clients: boolLabel(hasSkippedClients),
  });
};

const stageProcessingDuration = new Histogram({
  name: 'challenge_server_stage_processing_duration_ms',
  help: 'Time spent processing a stage',
  labelNames: ['stage'] as const,
  buckets: [50, 100, 200, 400, 800, 1_500, 3_000, 6_000, 12_000, 30_000],
  registers: [register],
});

export const observeStageProcessingDuration = (
  stage: Stage,
  durationMs: number,
): void => {
  stageProcessingDuration.observe({ stage: stageLabel(stage) }, durationMs);
};

export type ReportedTimePrecision = 'precise' | 'imprecise';

const clientReportedTimePrecision = new Counter({
  name: 'challenge_server_client_reported_time_precision_total',
  help: 'Client reported time precision',
  labelNames: ['precision'] as const,
  registers: [register],
});

export const recordClientReportedTimePrecision = (
  precision: ReportedTimePrecision,
): void => {
  clientReportedTimePrecision.inc({ precision });
};

const stagePayloadPerClient = new Histogram({
  name: 'challenge_server_stage_event_payload_per_client_bytes',
  help: 'Average payload size per client for stage events',
  labelNames: ['stage'] as const,
  buckets: [
    8 * 1024,
    16 * 1024,
    32 * 1024,
    64 * 1024,
    128 * 1024,
    256 * 1024,
    512 * 1024,
    1024 * 1024,
  ],
  registers: [register],
});

const stagePayloadTotal = new Counter({
  name: 'challenge_server_stage_event_payload_bytes_total',
  help: 'Total payload bytes per stage',
  labelNames: ['stage'] as const,
  registers: [register],
});

export const recordStageEventPayload = (
  stage: Stage,
  totalBytes: number,
  clientCount: number,
): void => {
  const labels = { stage: stageLabel(stage) };
  if (clientCount > 0) {
    stagePayloadPerClient.observe(labels, totalBytes / clientCount);
  }
  stagePayloadTotal.inc(labels, totalBytes);
};

const mergeDuration = new Histogram({
  name: 'challenge_server_merge_duration_ms',
  help: 'Time spent merging client events',
  labelNames: ['stage'] as const,
  buckets: [10, 25, 50, 100, 250, 500, 1_000, 2_000, 5_000, 10_000],
  registers: [register],
});

export const observeMergeDuration = (
  stage: Stage,
  durationMs: number,
): void => {
  mergeDuration.observe({ stage: stageLabel(stage) }, durationMs);
};

const mergeClients = new Counter({
  name: 'challenge_server_merge_clients_total',
  help: 'Per-client merge results',
  labelNames: ['classification', 'status'] as const,
  registers: [register],
});

export const recordMergeClient = (
  classification: MergeClientClassification,
  status: MergeClientStatus,
): void => {
  mergeClients.inc({ classification, status });
};

const mergeAlerts = new Counter({
  name: 'challenge_server_merge_alerts_total',
  help: 'Merge alert counts',
  labelNames: ['stage', 'type'] as const,
  registers: [register],
});

export const recordMergeAlert = (stage: Stage, type: MergeAlertType): void => {
  mergeAlerts.inc({ stage: stageLabel(stage), type });
};

const clientAnomalies = new Counter({
  name: 'challenge_server_client_anomalies_total',
  help: 'Client anomaly occurrences',
  labelNames: ['stage', 'anomaly'] as const,
  registers: [register],
});

export const recordClientAnomaly = (
  stage: Stage,
  anomaly: ClientAnomaly,
): void => {
  clientAnomalies.inc({ stage: stageLabel(stage), anomaly });
};

export type RepositoryTarget = 'challenge' | 'test';
export type RepositoryWriteKind = 'stage_events' | 'unmerged_events';
export type RepositoryResult = 'success' | 'error';

const repositoryWrites = new Counter({
  name: 'challenge_server_repository_writes_total',
  help: 'Repository write attempts',
  labelNames: ['target', 'kind', 'result'] as const,
  registers: [register],
});

export const recordRepositoryWrite = (
  target: RepositoryTarget,
  kind: RepositoryWriteKind,
  result: RepositoryResult,
): void => {
  repositoryWrites.inc({ target, kind, result });
};

const queryableEvents = new Counter({
  name: 'challenge_server_queryable_events_total',
  help: 'Number of queryable events persisted',
  labelNames: ['stage'] as const,
  registers: [register],
});

export const recordQueryableEvents = (stage: Stage, count: number): void => {
  queryableEvents.inc({ stage: stageLabel(stage) }, count);
};

export type ReportedTimeMismatchType = 'challenge' | 'overall';

const reportedTimeMismatches = new Counter({
  name: 'challenge_server_reported_time_mismatch_total',
  help: 'Reported time mismatches detected',
  labelNames: ['type'] as const,
  registers: [register],
});

export const recordReportedTimeMismatch = (
  type: ReportedTimeMismatchType,
): void => {
  reportedTimeMismatches.inc({ type });
};

export type TimeoutStateLabel =
  | 'none'
  | 'cleanup'
  | 'challenge_end'
  | 'stage_end';

const timeoutEvents = new Counter({
  name: 'challenge_server_timeout_events_total',
  help: 'Timeout handler activity',
  labelNames: ['state'] as const,
  registers: [register],
});

export const recordTimeoutEvent = (state: TimeoutStateLabel): void => {
  timeoutEvents.inc({ state });
};

export type CleanupStatusLabel =
  | 'ok'
  | 'active_clients'
  | 'processing_stage'
  | 'challenge_not_found'
  | 'challenge_failed_cleanup';

const cleanupAttempts = new Counter({
  name: 'challenge_server_cleanup_attempts_total',
  help: 'Challenge cleanup attempt outcomes',
  labelNames: ['status'] as const,
  registers: [register],
});

export const recordCleanupAttempt = (status: CleanupStatusLabel): void => {
  cleanupAttempts.inc({ status });
};

const sessionWatchdogRuns = new Counter({
  name: 'challenge_server_session_watchdog_runs_total',
  help: 'Session watchdog pass counts',
  labelNames: ['result'] as const,
  registers: [register],
});

export type SessionWatchdogResult =
  | 'expired_sessions'
  | 'no_expired_sessions'
  | 'error';

export const recordSessionWatchdogRun = (
  result: SessionWatchdogResult,
): void => {
  sessionWatchdogRuns.inc({ result });
};

const sessionsFinalized = new Counter({
  name: 'challenge_server_sessions_finalized_total',
  help: 'Session finalization counts',
  registers: [register],
});

export const recordSessionFinalized = (): void => {
  sessionsFinalized.inc();
};

export const metricsContentType = register.contentType;

export const getMetricsSnapshot = (): Promise<string> => register.metrics();
