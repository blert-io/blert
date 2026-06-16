import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createHash } from 'node:crypto';

import { ClientStageStream, Stage, StageStatus } from '@blert/common';

import { ClientEvents } from '../client-events';
import { ChallengeInfo, MergeClientStatus } from '../context';
import {
  MergeClientClassification,
  MergedEvents,
  Merger,
  MergeResult,
} from '../merge';
import { MergeAlertType } from '../quality';
import { MergeTracer } from '../trace';

/**
 * End-to-end merges of real recordings.
 *
 * If an intentional merger change shifts a digest, update the Jest snapshots
 * after confirming the structural assertions still describe the scenario.
 */

const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'integration');

type Fixture = {
  challengeInfo: ChallengeInfo;
  stage: Stage;
  stream: ClientStageStream[];
};

function loadFixture(name: string): Fixture {
  const raw = JSON.parse(
    zlib
      .gunzipSync(fs.readFileSync(path.join(FIXTURE_DIR, `${name}.json.gz`)))
      .toString(),
  ) as {
    // Corpus recordings predate `mode` on the challenge info.
    challengeInfo: Omit<ChallengeInfo, 'mode'> & {
      mode?: ChallengeInfo['mode'];
    };
    stage: Stage;
    rawEvents: (ClientStageStream & { events?: { data: number[] } })[];
  };
  return {
    challengeInfo: { mode: 0, ...raw.challengeInfo },
    stage: raw.stage,
    stream: raw.rawEvents.map((record) =>
      'events' in record && record.events !== undefined
        ? { ...record, events: Buffer.from(record.events.data) }
        : record,
    ) as ClientStageStream[],
  };
}

function merge(
  fixture: Fixture,
  tracer?: MergeTracer,
  clientOrder: 'forward' | 'reversed' = 'forward',
): MergeResult | null {
  const byClient = new Map<number, ClientStageStream[]>();
  for (const record of fixture.stream) {
    const existing = byClient.get(record.clientId);
    if (existing === undefined) {
      byClient.set(record.clientId, [record]);
    } else {
      existing.push(record);
    }
  }
  const clients = [...byClient.entries()].map(([id, stream]) =>
    ClientEvents.fromClientStream(
      id,
      fixture.challengeInfo,
      fixture.stage,
      stream,
    ),
  );
  if (clientOrder === 'reversed') {
    clients.reverse();
  }
  return new Merger(fixture.challengeInfo, fixture.stage, clients).merge({
    tracer,
  });
}

function digest(events: MergedEvents): string {
  return createHash('sha256').update(events.serialize()).digest('hex');
}

function clientSummary(result: MergeResult) {
  return result.clients
    .map((c) => ({
      id: c.id,
      status: c.status,
      classification: c.classification,
    }))
    .sort((a, b) => a.id - b.id);
}

describe('merge integration', () => {
  it('merges a clean three-client completion identically', () => {
    const result = merge(loadFixture('clean-merge'))!;

    expect(clientSummary(result)).toEqual([
      {
        id: 166,
        status: MergeClientStatus.MERGED,
        classification: MergeClientClassification.MISMATCHED,
      },
      {
        id: 215,
        status: MergeClientStatus.MERGED,
        classification: MergeClientClassification.REFERENCE,
      },
      {
        id: 282,
        status: MergeClientStatus.MERGED,
        classification: MergeClientClassification.MATCHING,
      },
    ]);
    expect(result.alerts).toEqual([]);
    expect(result.clients.every((c) => c.anomalies.length === 0)).toBe(true);
    expect(result.clients.every((c) => c.qualityFlags.length === 0)).toBe(true);
    expect(result.referenceSelection.method).toBe('ACCURATE_MODAL');
    expect(result.referenceSelection.count).toBe(75);

    const events = result.events;
    expect(events.getStatus()).toBe(StageStatus.COMPLETED);
    expect(events.getLastTick()).toBe(75);
    expect(events.getMissingTickCount()).toBe(0);
    expect(events.hasPreciseServerTickCount()).toBe(true);
    expect(events.accurateUntil()).toBe(76);
    expect(events.queryableUntil()).toBe(76);
    expect([...events]).toHaveLength(432);
    expect(digest(events)).toMatchSnapshot();
  });

  it('promotes accuracy from inaccurate clients up to the contiguity cut', () => {
    const result = merge(loadFixture('accuracy-promotion'))!;

    expect(result.clients.every((c) => !c.derivedAccurate)).toBe(true);
    expect(result.mergedCount).toBe(2);
    expect(result.referenceSelection.method).toBe('RECORDED_TICKS');

    const events = result.events;
    expect(events.getStatus()).toBe(StageStatus.WIPED);
    expect(events.getLastTick()).toBe(44);
    expect(events.accurateUntil()).toBe(43);
    expect(events.queryableUntil()).toBe(43);
    expect([...events]).toHaveLength(130);
    expect(digest(events)).toMatchSnapshot();
  });

  it('aligns a laggy mismatched client across gaps', () => {
    const tracer = new MergeTracer();
    const result = merge(loadFixture('aligned-gaps'), tracer)!;

    expect(clientSummary(result)).toEqual([
      {
        id: 42,
        status: MergeClientStatus.MERGED,
        classification: MergeClientClassification.MISMATCHED,
      },
      {
        id: 61,
        status: MergeClientStatus.MERGED,
        classification: MergeClientClassification.REFERENCE,
      },
    ]);
    const gapCount = Math.max(
      0,
      ...tracer.toTrace().mergeSteps.map((s) => s.alignment?.gapCount ?? 0),
    );
    expect(gapCount).toBe(6);

    const events = result.events;
    expect(events.getStatus()).toBe(StageStatus.COMPLETED);
    expect(events.getLastTick()).toBe(133);
    expect(events.accurateUntil()).toBe(134);
    expect(events.queryableUntil()).toBe(134);
    expect([...events]).toHaveLength(573);
    expect(digest(events)).toMatchSnapshot();
  });

  it('rejects a drifted client on weapon cooldown violations', () => {
    const result = merge(loadFixture('cooldown-rejection'))!;

    expect(result.mergedCount).toBe(1);
    expect(result.unmergedCount).toBe(1);
    expect(result.alerts.map((a) => a.type)).toEqual([
      MergeAlertType.POST_MERGE_CONSISTENCY_REJECTIONS,
    ]);

    const rejected = result.clients.find(
      (c) => c.status === MergeClientStatus.UNMERGED,
    )!;
    expect(rejected.id).toBe(357);
    expect(
      rejected.mergeIssues.map((i) => ({
        kind: i.kind,
        player: 'player' in i ? i.player : null,
      })),
    ).toEqual([
      { kind: 'WEAPON_COOLDOWN_VIOLATION', player: 'player1' },
      { kind: 'WEAPON_COOLDOWN_VIOLATION', player: 'player2' },
    ]);

    // The rejection keeps the base client's timeline intact.
    const events = result.events;
    expect(events.getLastTick()).toBe(58);
    expect([...events]).toHaveLength(233);
    expect(digest(events)).toMatchSnapshot();
  });

  it('leaves a client unmerged when alignment finds nothing', () => {
    const result = merge(loadFixture('unmerged-no-alignment'))!;

    expect(result.mergedCount).toBe(1);
    expect(result.unmergedCount).toBe(1);
    expect(result.alerts).toEqual([]);

    const unmerged = result.clients.find(
      (c) => c.status === MergeClientStatus.UNMERGED,
    )!;
    expect(unmerged.id).toBe(3);
    // The step never reached consistency checking.
    expect(unmerged.mergeIssues).toEqual([]);

    expect(result.events.getLastTick()).toBe(84);
    expect(digest(result.events)).toMatchSnapshot();
  });

  it('offsets a short timeline to the stage end under a precise count', () => {
    const result = merge(loadFixture('timeline-offset'))!;

    expect(result.clients).toHaveLength(1);
    expect(result.alerts.map((a) => a.type)).toEqual([
      MergeAlertType.TIMELINE_OFFSET_APPLIED,
    ]);
    expect(result.referenceSelection.method).toBe('PRECISE_SERVER');

    const events = result.events;
    expect(events.getLastTick()).toBe(133);
    // The offset leaves an unverified empty prefix.
    expect(events.getMissingTickCount()).toBe(6);
    expect(events.accurateUntil()).toBe(0);
    expect(events.queryableUntil()).toBe(0);
    expect(digest(events)).toMatchSnapshot();
  });

  it('flags a merged client whose confidence falls below the warn threshold', () => {
    const result = merge(loadFixture('low-confidence'))!;

    expect(result.alerts.map((a) => a.type)).toEqual([
      MergeAlertType.LOW_STRUCTURAL_CONFIDENCE,
    ]);
    const flagged = result.clients.find((c) => c.worstSegmentScore !== null)!;
    expect(flagged.status).toBe(MergeClientStatus.MERGED);
    expect(flagged.worstSegmentScore).toBeLessThan(0.4);

    expect(result.events.getLastTick()).toBe(88);
    expect(digest(result.events)).toMatchSnapshot();
  });

  it('cuts the queryable prefix at a cross-client content disagreement', () => {
    const result = merge(loadFixture('contested-queryable'))!;

    expect(result.mergedCount).toBe(2);
    const events = result.events;
    expect(events.getLastTick()).toBe(416);
    expect(events.accurateUntil()).toBe(417);
    expect(events.queryableUntil()).toBe(144);
    expect([...events]).toHaveLength(3535);
    expect(digest(events)).toMatchSnapshot();
  });

  it.each([
    ['clean-merge'],
    ['accuracy-promotion'],
    ['aligned-gaps'],
    ['cooldown-rejection'],
    ['unmerged-no-alignment'],
    ['low-confidence'],
    ['contested-queryable'],
  ])('merges %s identically regardless of client input order', (name) => {
    const fixture = loadFixture(name);
    const forward = merge(fixture)!;
    const reversed = merge(fixture, undefined, 'reversed')!;
    expect(digest(reversed.events)).toBe(digest(forward.events));
  });
});
