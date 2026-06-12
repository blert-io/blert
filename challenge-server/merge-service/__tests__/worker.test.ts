jest.mock('../../metrics');

import {
  ChallengeMode,
  ChallengeType,
  ClientStageStream,
  DataSource,
  Stage,
  StageStatus,
  StageStreamType,
} from '@blert/common';
import { ChallengeEvents } from '@blert/common/generated/challenge_storage_pb';

import {
  ChallengeInfo,
  ClientEvents,
  MergedEvents,
  Merger,
} from '../../merging';
import { createPlayerUpdateEvent } from '../../merging/__tests__/fixtures';
import { MergeJob } from '../types';
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

describe('runMergeJob', () => {
  it('decodes, merges, and serializes identically to an in-process merge', () => {
    const stream = buildStream();
    const job: MergeJob = {
      challengeInfo,
      stage: Stage.TOB_MAIDEN,
      attempt: 0,
      stream,
    };

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
    expect(direct).not.toBeNull();

    const reply = runMergeJob(job);
    expect(reply.kind).toBe('merged');
    if (reply.kind !== 'merged') {
      return;
    }

    const restored = MergedEvents.deserialize(reply.events);
    expect(Array.from(restored).map((e) => e.toObject())).toEqual(
      Array.from(direct!.events).map((e) => e.toObject()),
    );
    expect(reply.result.mergedCount).toBe(direct!.mergedCount);
    expect(reply.result.unmergedCount).toBe(direct!.unmergedCount);
    expect(reply.result.skippedCount).toBe(direct!.skippedCount);
    expect(reply.result.clients).toEqual(direct!.clients);
  });

  it('reports bad data when the stream has no mergeable clients', () => {
    const reply = runMergeJob({
      challengeInfo,
      stage: Stage.TOB_MAIDEN,
      attempt: 0,
      stream: [],
    });
    expect(reply.kind).toBe('bad_data');
  });

  it('reports bad data when no client data survives decoding', () => {
    const reply = runMergeJob({
      challengeInfo,
      stage: Stage.TOB_MAIDEN,
      attempt: 0,
      stream: [
        {
          type: StageStreamType.STAGE_EVENTS,
          clientId: 1,
          events: new Uint8Array([0xff, 0xff, 0xff, 0xff]),
        },
      ],
    });
    expect(reply.kind).toBe('bad_data');
  });
});
