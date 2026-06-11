jest.mock('../../metrics');

import {
  ChallengeMode,
  ChallengeType,
  ClientStageStream,
  DataRepository,
  DataSource,
  Stage,
  StageStatus,
  StageStreamType,
} from '@blert/common';
import { ChallengeEvents } from '@blert/common/generated/challenge_storage_pb';

import {
  ChallengeInfo,
  ClientEvents,
  MergeAlertType,
  Merger,
} from '../../merging';
import { recordMergeOutcome } from '../../metrics';
import { createPlayerUpdateEvent } from '../../merging/__tests__/fixtures';
import { CaptureReason } from '../policy';
import {
  CaptureIndexEntry,
  MergeService,
  parseUnmergedEventsFile,
  unmergedEventsFile,
} from '../service';
import { MergeResultStore, StageMerge } from '../store';
import { MergeReply, MergeRunner, UnmergedEventData } from '../types';
import { runMergeJob } from '../worker';

const challengeInfo: ChallengeInfo = {
  uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeffffff',
  type: ChallengeType.TOB,
  mode: ChallengeMode.TOB_REGULAR,
  party: ['player1'],
};

function buildStream(): ClientStageStream[] {
  const events = [0, 1, 2].map((tick) =>
    createPlayerUpdateEvent({
      tick,
      name: 'player1',
      source: DataSource.PRIMARY,
      x: 10 + tick,
      y: 10,
    }),
  );
  const wrapper = new ChallengeEvents();
  wrapper.setEventsList(events);
  return [
    {
      type: StageStreamType.STAGE_EVENTS,
      clientId: 1,
      events: wrapper.serializeBinary(),
    },
    {
      type: StageStreamType.STAGE_END,
      clientId: 1,
      update: {
        stage: Stage.TOB_MAIDEN,
        status: StageStatus.COMPLETED,
        accurate: true,
        recordedTicks: 2,
        serverTicks: { count: 2, precise: true },
      },
    },
  ];
}

function runnerReturning(reply: MergeReply): MergeRunner {
  return { run: async () => reply, destroy: () => Promise.resolve() };
}

describe('MergeService.merge', () => {
  const stream = buildStream();

  it('returns the deserialized merged events for a merged reply', async () => {
    const reply = runMergeJob({
      challengeInfo,
      stage: Stage.TOB_MAIDEN,
      attempt: 0,
      stream,
    });
    expect(reply.kind).toBe('merged');

    const service = new MergeService(runnerReturning(reply));
    const events = await service.merge(
      challengeInfo,
      Stage.TOB_MAIDEN,
      0,
      stream,
    );

    const client = ClientEvents.fromClientStream(
      1,
      challengeInfo,
      Stage.TOB_MAIDEN,
      stream,
    );
    const direct = new Merger(challengeInfo, Stage.TOB_MAIDEN, [client]).merge(
      undefined,
      { alignMismatched: true },
    );

    expect(events).not.toBeNull();
    expect(Array.from(events!).map((e) => e.toObject())).toEqual(
      Array.from(direct!.events).map((e) => e.toObject()),
    );
    expect(recordMergeOutcome).toHaveBeenCalledWith('merged');
  });

  it('returns null for a bad data reply', async () => {
    const service = new MergeService(runnerReturning({ kind: 'bad_data' }));
    expect(
      await service.merge(challengeInfo, Stage.TOB_MAIDEN, 0, stream),
    ).toBeNull();
    expect(recordMergeOutcome).toHaveBeenCalledWith('bad_data');
  });

  it('returns null for an exception reply', async () => {
    const service = new MergeService(runnerReturning({ kind: 'exception' }));
    expect(
      await service.merge(challengeInfo, Stage.TOB_MAIDEN, 0, stream),
    ).toBeNull();
    expect(recordMergeOutcome).toHaveBeenCalledWith('exception');
  });

  it('returns null without dispatching when the stream has no clients', async () => {
    let dispatched = false;
    const runner: MergeRunner = {
      run: async () => {
        dispatched = true;
        return { kind: 'bad_data' };
      },
      destroy: () => Promise.resolve(),
    };
    const service = new MergeService(runner);

    expect(
      await service.merge(challengeInfo, Stage.TOB_MAIDEN, 0, []),
    ).toBeNull();
    expect(dispatched).toBe(false);
  });

  it('returns null when the merged events fail to deserialize', async () => {
    const reply = runMergeJob({
      challengeInfo,
      stage: Stage.TOB_MAIDEN,
      attempt: 0,
      stream,
    });
    expect(reply.kind).toBe('merged');
    if (reply.kind !== 'merged') {
      return;
    }

    const service = new MergeService(
      runnerReturning({ ...reply, events: 'not a serialized payload' }),
    );
    expect(
      await service.merge(challengeInfo, Stage.TOB_MAIDEN, 0, stream),
    ).toBeNull();
    expect(recordMergeOutcome).toHaveBeenCalledWith('deserialize_failed');
  });

  it('returns null when the runner repeatedly rejects', async () => {
    let attempts = 0;
    const runner: MergeRunner = {
      run: async () => {
        attempts++;
        throw new Error('worker died');
      },
      destroy: () => Promise.resolve(),
    };
    const service = new MergeService(runner);

    expect(
      await service.merge(challengeInfo, Stage.TOB_MAIDEN, 0, stream),
    ).toBeNull();
    expect(attempts).toBe(2);
    expect(recordMergeOutcome).toHaveBeenCalledWith('runner_failed');
  });

  it('recovers when the runner fails transiently', async () => {
    const reply = runMergeJob({
      challengeInfo,
      stage: Stage.TOB_MAIDEN,
      attempt: 0,
      stream,
    });
    let attempts = 0;
    const runner: MergeRunner = {
      run: async () => {
        attempts++;
        if (attempts === 1) {
          throw new Error('worker recycled');
        }
        return reply;
      },
      destroy: () => Promise.resolve(),
    };
    const service = new MergeService(runner);

    const events = await service.merge(
      challengeInfo,
      Stage.TOB_MAIDEN,
      0,
      stream,
    );
    expect(events).not.toBeNull();
    expect(attempts).toBe(2);
    expect(recordMergeOutcome).toHaveBeenCalledWith('merged');
  });
});

function fakeRepository(store: Map<string, Buffer>): DataRepository {
  return {
    saveRaw: async (path: string, data: Uint8Array) => {
      store.set(path, Buffer.from(data));
    },
    loadRaw: async (path: string) => {
      const data = store.get(path);
      if (data === undefined) {
        throw new Error(`not found: ${path}`);
      }
      return data;
    },
  } as unknown as DataRepository;
}

const INDEX_FILE = 'unmerged-events/index.json';

describe('MergeService captures', () => {
  const stream = buildStream();

  function mergedReplyWithAlert(): MergeReply {
    const reply = runMergeJob({
      challengeInfo,
      stage: Stage.TOB_MAIDEN,
      attempt: 7,
      stream,
    });
    if (reply.kind !== 'merged') {
      throw new Error('expected a merged reply');
    }
    return {
      ...reply,
      result: {
        ...reply.result,
        alerts: [{ type: MergeAlertType.MULTIPLE_ACCURATE_TICK_MODES }],
      },
    };
  }

  it('saves triggered captures and indexes them', async () => {
    const store = new Map<string, Buffer>();
    const service = new MergeService(runnerReturning(mergedReplyWithAlert()), {
      samplingRepository: fakeRepository(store),
    });

    const events = await service.merge(
      challengeInfo,
      Stage.TOB_MAIDEN,
      7,
      stream,
    );
    expect(events).not.toBeNull();

    // The capture is written from a timer to stay off the merge path.
    await new Promise((resolve) => setTimeout(resolve, 10));

    const captureFile = `unmerged-events/${challengeInfo.uuid}:${Stage.TOB_MAIDEN}:7_events.json`;
    expect([...store.keys()].sort()).toEqual([captureFile, INDEX_FILE].sort());

    const capture = JSON.parse(
      store.get(captureFile)!.toString(),
    ) as UnmergedEventData;
    expect(capture.challengeInfo).toEqual(challengeInfo);
    expect(capture.stage).toBe(Stage.TOB_MAIDEN);
    expect(capture.attempt).toBe(7);
    expect(capture.captureReasons).toEqual([
      CaptureReason.ACCURATE_TICK_DISAGREEMENT,
    ]);
    expect(capture.rawEvents).toHaveLength(stream.length);

    const index = JSON.parse(
      store.get(INDEX_FILE)!.toString(),
    ) as CaptureIndexEntry[];
    expect(index).toHaveLength(1);
    expect(index[0]).toEqual({
      file: captureFile,
      challengeId: challengeInfo.uuid,
      stage: Stage.TOB_MAIDEN,
      attempt: 7,
      reasons: [CaptureReason.ACCURATE_TICK_DISAGREEMENT],
      savedAt: expect.any(Number) as number,
    });
  });

  it('captures the streams of a merge that fails outright', async () => {
    const store = new Map<string, Buffer>();
    const service = new MergeService(runnerReturning({ kind: 'exception' }), {
      samplingRepository: fakeRepository(store),
    });

    expect(
      await service.merge(challengeInfo, Stage.TOB_MAIDEN, 3, stream),
    ).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 10));

    const captureFile = `unmerged-events/${challengeInfo.uuid}:${Stage.TOB_MAIDEN}:3_events.json`;
    const capture = JSON.parse(
      store.get(captureFile)!.toString(),
    ) as UnmergedEventData;
    expect(capture.captureReasons).toEqual([CaptureReason.MERGE_FAILED]);
    expect(capture.mergedClients).toEqual([]);
    expect(capture.unmergedClients).toEqual([]);
    expect(capture.rawEvents).toHaveLength(stream.length);

    const index = JSON.parse(
      store.get(INDEX_FILE)!.toString(),
    ) as CaptureIndexEntry[];
    expect(index.map((e) => ({ file: e.file, reasons: e.reasons }))).toEqual([
      { file: captureFile, reasons: [CaptureReason.MERGE_FAILED] },
    ]);
  });

  it('captures the streams of an all-bad-data merge', async () => {
    const store = new Map<string, Buffer>();
    const service = new MergeService(runnerReturning({ kind: 'bad_data' }), {
      samplingRepository: fakeRepository(store),
    });

    expect(
      await service.merge(challengeInfo, Stage.TOB_MAIDEN, 3, stream),
    ).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 10));

    const captureFile = `unmerged-events/${challengeInfo.uuid}:${Stage.TOB_MAIDEN}:3_events.json`;
    const capture = JSON.parse(
      store.get(captureFile)!.toString(),
    ) as UnmergedEventData;
    expect(capture.captureReasons).toEqual([CaptureReason.BAD_DATA]);
    expect(capture.rawEvents).toHaveLength(stream.length);
  });

  it('stops capturing once the rate cap is reached', async () => {
    const store = new Map<string, Buffer>();
    const service = new MergeService(runnerReturning(mergedReplyWithAlert()), {
      samplingRepository: fakeRepository(store),
      maxCapturesPerHour: 1,
    });

    await service.merge(challengeInfo, Stage.TOB_MAIDEN, 1, stream);
    await service.merge(challengeInfo, Stage.TOB_MAIDEN, 2, stream);
    await new Promise((resolve) => setTimeout(resolve, 10));

    const captureFile = `unmerged-events/${challengeInfo.uuid}:${Stage.TOB_MAIDEN}:1_events.json`;
    expect([...store.keys()].sort()).toEqual([captureFile, INDEX_FILE].sort());

    const index = JSON.parse(
      store.get(INDEX_FILE)!.toString(),
    ) as CaptureIndexEntry[];
    expect(index.map((e) => e.file)).toEqual([captureFile]);
  });

  it('lists captures filtered and ordered by recency', async () => {
    const entries: CaptureIndexEntry[] = [
      {
        file: 'unmerged-events/aaa:10_events.json',
        challengeId: 'aaa',
        stage: 10,
        attempt: null,
        reasons: [CaptureReason.BASELINE],
        savedAt: 100,
      },
      {
        file: 'unmerged-events/bbb:12_events.json',
        challengeId: 'bbb',
        stage: 12,
        attempt: null,
        reasons: [CaptureReason.UNMERGED_CLIENTS, CaptureReason.BAD_DATA],
        savedAt: 300,
      },
      {
        file: 'unmerged-events/aaa:12_events.json',
        challengeId: 'aaa',
        stage: 12,
        attempt: 1,
        reasons: [CaptureReason.UNMERGED_CLIENTS],
        savedAt: 200,
      },
    ];
    const store = new Map<string, Buffer>([
      [INDEX_FILE, Buffer.from(JSON.stringify(entries))],
    ]);
    const service = new MergeService(runnerReturning({ kind: 'bad_data' }), {
      samplingRepository: fakeRepository(store),
    });

    const byReason = await service.listCaptures({
      reason: CaptureReason.UNMERGED_CLIENTS,
    });
    expect(byReason.map((e) => e.file)).toEqual([
      'unmerged-events/bbb:12_events.json',
      'unmerged-events/aaa:12_events.json',
    ]);

    const byChallenge = await service.listCaptures({ challengeId: 'aaa' });
    expect(byChallenge.map((e) => e.savedAt)).toEqual([200, 100]);

    const byStageAndAttempt = await service.listCaptures({
      stage: 12,
      attempt: 1,
    });
    expect(byStageAndAttempt.map((e) => e.file)).toEqual([
      'unmerged-events/aaa:12_events.json',
    ]);

    expect(await service.listCaptures({}, 2)).toHaveLength(2);
  });

  it('lists no captures without an index or repository', async () => {
    const service = new MergeService(runnerReturning({ kind: 'bad_data' }), {
      samplingRepository: fakeRepository(new Map()),
    });
    expect(await service.listCaptures()).toEqual([]);

    const noRepository = new MergeService(
      runnerReturning({ kind: 'bad_data' }),
    );
    expect(await noRepository.listCaptures()).toEqual([]);
  });
});

describe('MergeService result persistence', () => {
  const stream = buildStream();

  function reply(): MergeReply {
    const r = runMergeJob({
      challengeInfo,
      stage: Stage.TOB_MAIDEN,
      attempt: 7,
      stream,
    });
    if (r.kind !== 'merged') {
      throw new Error('expected a merged reply');
    }
    return {
      ...r,
      result: {
        ...r.result,
        alerts: [{ type: MergeAlertType.MULTIPLE_ACCURATE_TICK_MODES }],
      },
    };
  }

  it('saves every merge, linking its capture when one was taken', async () => {
    const saved: StageMerge[] = [];
    const store: MergeResultStore = {
      saveStageMerge: async (merge) => {
        saved.push(merge);
      },
    };
    const service = new MergeService(runnerReturning(reply()), {
      samplingRepository: fakeRepository(new Map()),
      resultStore: store,
    });

    const events = await service.merge(
      challengeInfo,
      Stage.TOB_MAIDEN,
      7,
      stream,
    );

    expect(saved).toHaveLength(1);
    const merge = saved[0];
    expect(merge.challengeInfo).toEqual(challengeInfo);
    expect(merge.stage).toBe(Stage.TOB_MAIDEN);
    expect(merge.attempt).toBe(7);
    expect(merge.events).toBe(events);
    expect(merge.result.alerts).toEqual([
      { type: MergeAlertType.MULTIPLE_ACCURATE_TICK_MODES },
    ]);
    expect(merge.capture).toEqual({
      reasons: [CaptureReason.ACCURATE_TICK_DISAGREEMENT],
      file: `unmerged-events/${challengeInfo.uuid}:${Stage.TOB_MAIDEN}:7_events.json`,
    });
  });

  it('saves without capture when sampling is not configured', async () => {
    const saved: StageMerge[] = [];
    const store: MergeResultStore = {
      saveStageMerge: async (merge) => {
        saved.push(merge);
      },
    };
    const service = new MergeService(runnerReturning(reply()), {
      resultStore: store,
    });

    const events = await service.merge(
      challengeInfo,
      Stage.TOB_MAIDEN,
      7,
      stream,
    );

    expect(saved).toHaveLength(1);
    const merge = saved[0];
    expect(merge.challengeInfo).toEqual(challengeInfo);
    expect(merge.stage).toBe(Stage.TOB_MAIDEN);
    expect(merge.attempt).toBe(7);
    expect(merge.events).toBe(events);
    expect(merge.result.alerts).toEqual([
      { type: MergeAlertType.MULTIPLE_ACCURATE_TICK_MODES },
    ]);
    expect(merge.capture).toBeNull();
  });

  it('returns the merged events even if the store fails', async () => {
    const store: MergeResultStore = {
      saveStageMerge: async () => {
        throw new Error('database down');
      },
    };
    const service = new MergeService(runnerReturning(reply()), {
      resultStore: store,
    });

    const events = await service.merge(
      challengeInfo,
      Stage.TOB_MAIDEN,
      7,
      stream,
    );
    expect(events).not.toBeNull();
  });
});

describe('capture file names', () => {
  it('round-trips without an attempt', () => {
    const file = unmergedEventsFile('abc-123', Stage.TOB_VERZIK);
    expect(parseUnmergedEventsFile(file)).toEqual({
      challengeId: 'abc-123',
      stage: Stage.TOB_VERZIK,
      attempt: null,
    });
  });

  it('round-trips with an attempt', () => {
    const file = unmergedEventsFile('abc-123', Stage.MOKHAIOTL_DELVE_8PLUS, 3);
    expect(parseUnmergedEventsFile(file)).toEqual({
      challengeId: 'abc-123',
      stage: Stage.MOKHAIOTL_DELVE_8PLUS,
      attempt: 3,
    });
  });

  it('rejects file names which are not captures', () => {
    expect(parseUnmergedEventsFile(INDEX_FILE)).toBeNull();
    expect(parseUnmergedEventsFile('unmerged-events/readme.txt')).toBeNull();
  });
});
