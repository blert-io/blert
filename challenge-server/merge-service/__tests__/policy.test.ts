import {
  ClientAnomaly,
  MergeAlertType,
  MergeClient,
  MergeClientClassification,
  MergeClientStatus,
  QualityFlag,
} from '../../merging';
import { CaptureReason, captureReasons, sampleCapture } from '../policy';
import { MergeResultMetadata } from '../types';

function makeClient(overrides: Partial<MergeClient> = {}): MergeClient {
  return {
    id: 1,
    primaryPlayer: 'player1',
    metadata: null,
    status: MergeClientStatus.MERGED,
    classification: MergeClientClassification.MATCHING,
    sequenceNumber: 0,
    recordedTicks: 100,
    serverTicks: { count: 100, precise: true },
    reportedAccurate: true,
    derivedAccurate: true,
    anomalies: [],
    consistencyIssues: [],
    qualityFlags: [],
    rejectionReason: null,
    mergeIssues: [],
    worstSegmentScore: null,
    ...overrides,
  };
}

function makeResult(
  overrides: Partial<MergeResultMetadata> = {},
): MergeResultMetadata {
  return {
    clients: [makeClient(), makeClient({ id: 2 })],
    mergedCount: 2,
    unmergedCount: 0,
    skippedCount: 0,
    alerts: [],
    referenceSelection: {
      count: 100,
      method:
        'ACCURATE_MODAL' as MergeResultMetadata['referenceSelection']['method'],
    },
    ...overrides,
  };
}

describe('captureReasons', () => {
  it('returns only a baseline reason for a clean merge', () => {
    expect(captureReasons(makeResult())).toEqual([CaptureReason.BASELINE]);
  });

  it.each([
    [
      MergeAlertType.MULTIPLE_ACCURATE_TICK_MODES,
      CaptureReason.ACCURATE_TICK_DISAGREEMENT,
    ],
    [
      MergeAlertType.MULTIPLE_SERVER_TICK_COUNTS,
      CaptureReason.SERVER_TICK_DISAGREEMENT,
    ],
    [
      MergeAlertType.POST_MERGE_CONSISTENCY_REJECTIONS,
      CaptureReason.MERGE_REJECTION,
    ],
    [MergeAlertType.LOW_CONFIDENCE_REJECTIONS, CaptureReason.MERGE_REJECTION],
    [MergeAlertType.LOW_STRUCTURAL_CONFIDENCE, CaptureReason.LOW_CONFIDENCE],
  ])('maps a %s alert to %s', (alertType, reason) => {
    const result = makeResult({ alerts: [{ type: alertType }] });
    expect(captureReasons(result)).toEqual([reason]);
  });

  it('does not capture a single-client timeline offset', () => {
    const result = makeResult({
      clients: [makeClient()],
      alerts: [{ type: MergeAlertType.TIMELINE_OFFSET_APPLIED }],
    });
    expect(captureReasons(result)).toEqual([CaptureReason.BASELINE]);
  });

  it('captures a multi-client timeline offset', () => {
    const result = makeResult({
      alerts: [{ type: MergeAlertType.TIMELINE_OFFSET_APPLIED }],
    });
    expect(captureReasons(result)).toEqual([CaptureReason.TIMELINE_OFFSET]);
  });

  it.each([
    [
      ClientAnomaly.MULTIPLE_PRIMARY_PLAYERS,
      CaptureReason.MULTIPLE_PRIMARY_PLAYERS,
    ],
    [ClientAnomaly.BAD_DATA, CaptureReason.BAD_DATA],
    [
      ClientAnomaly.EVENTS_BEYOND_RECORDED_TICKS,
      CaptureReason.EVENTS_BEYOND_RECORDED_TICKS,
    ],
    [ClientAnomaly.GAME_CORRECTION_APPLIED, CaptureReason.GAME_CORRECTION],
  ])('maps a %s anomaly to %s', (anomaly, reason) => {
    const result = makeResult({
      clients: [makeClient({ anomalies: [anomaly] })],
    });
    expect(captureReasons(result)).toEqual([reason]);
  });

  it.each([
    [ClientAnomaly.CONSISTENCY_ISSUES],
    [ClientAnomaly.MISSING_STAGE_METADATA],
  ])('does not capture for a %s anomaly alone', (anomaly) => {
    const result = makeResult({
      clients: [makeClient({ anomalies: [anomaly] })],
    });
    expect(captureReasons(result)).toEqual([CaptureReason.BASELINE]);
  });

  it('captures clients with borderline merge confidence', () => {
    const result = makeResult({
      clients: [makeClient({ worstSegmentScore: 0.8 })],
    });
    expect(captureReasons(result)).toEqual([CaptureReason.LOW_CONFIDENCE]);
  });

  it('does not capture clients with high merge confidence', () => {
    const result = makeResult({
      clients: [makeClient({ worstSegmentScore: 0.95 })],
    });
    expect(captureReasons(result)).toEqual([CaptureReason.BASELINE]);
  });

  it('captures noteworthy quality flags', () => {
    const result = makeResult({
      clients: [
        makeClient({
          qualityFlags: [{ kind: 'ATTACK_TYPE_MISMATCH' } as QualityFlag],
        }),
      ],
    });
    expect(captureReasons(result)).toEqual([CaptureReason.QUALITY_FLAGS]);
  });

  it('ignores quality flags which are not noteworthy', () => {
    const result = makeResult({
      clients: [
        makeClient({
          qualityFlags: [{ kind: 'LARGE_TEMPORAL_GAP' } as QualityFlag],
        }),
      ],
    });
    expect(captureReasons(result)).toEqual([CaptureReason.BASELINE]);
  });

  it.each([
    ['unmerged', { unmergedCount: 1 }],
    ['skipped', { skippedCount: 1 }],
  ])('captures results with %s clients', (_, counts) => {
    expect(captureReasons(makeResult(counts))).toEqual([
      CaptureReason.UNMERGED_CLIENTS,
    ]);
  });

  it('deduplicates reasons across clients and omits the baseline', () => {
    const result = makeResult({
      clients: [
        makeClient({ worstSegmentScore: 0.5 }),
        makeClient({ id: 2, worstSegmentScore: 0.6 }),
      ],
      alerts: [{ type: MergeAlertType.LOW_STRUCTURAL_CONFIDENCE }],
      unmergedCount: 1,
    });
    expect(captureReasons(result).sort()).toEqual(
      [CaptureReason.LOW_CONFIDENCE, CaptureReason.UNMERGED_CLIENTS].sort(),
    );
  });
});

describe('sampleCapture', () => {
  it('always captures reasons with a full sampling rate', () => {
    expect(sampleCapture([CaptureReason.MERGE_REJECTION], () => 0.999999)).toBe(
      true,
    );
  });

  it('rolls sampled reasons against their rate', () => {
    expect(sampleCapture([CaptureReason.BASELINE], () => 0)).toBe(true);
    expect(sampleCapture([CaptureReason.BASELINE], () => 0.5)).toBe(false);
  });

  it('captures if any of multiple reasons passes its roll', () => {
    const rolls = [0.9, 0.1];
    const rng = () => rolls.shift()!;
    expect(
      sampleCapture(
        [CaptureReason.BASELINE, CaptureReason.UNMERGED_CLIENTS],
        rng,
      ),
    ).toBe(true);
  });

  it('does not capture without reasons', () => {
    expect(sampleCapture([], () => 0)).toBe(false);
  });
});
