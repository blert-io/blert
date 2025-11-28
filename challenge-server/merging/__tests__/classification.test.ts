import {
  ChallengeStatus,
  ChallengeType,
  Stage,
  StageStatus,
} from '@blert/common';

import { classifyClients, ReferenceSelectionMethod } from '../classification';
import { ClientEvents } from '../client-events';

const fakeChallenge = {
  id: 99,
  uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeffffff',
  type: ChallengeType.TOB,
  status: ChallengeStatus.WIPED,
  stage: Stage.TOB_SOTETSEG,
  party: ['player1', 'player2'],
};

describe('classifyClients', () => {
  function createClient(
    id: number,
    accurate: boolean,
    recordedTicks: number,
    serverTicks: { count: number; precise: boolean } | null,
  ) {
    return ClientEvents.fromRawEvents(
      id,
      fakeChallenge,
      {
        stage: Stage.TOB_MAIDEN,
        status: StageStatus.WIPED,
        accurate,
        recordedTicks,
        serverTicks,
      },
      [],
    );
  }

  it('picks a single client as the base', () => {
    const client = createClient(1, true, 10, { count: 10, precise: true });
    const { base, matching, mismatched, referenceTicks } = classifyClients([
      client,
    ]);
    expect(base).toBe(client);
    expect(matching).toEqual([]);
    expect(mismatched).toEqual([]);
    expect(referenceTicks).toMatchObject({
      count: 10,
      method: ReferenceSelectionMethod.ACCURATE_MODAL,
    });
  });

  it('uses an accurate client if present', () => {
    const acc1 = createClient(1, true, 10, { count: 10, precise: true });
    const acc2 = createClient(2, true, 10, { count: 10, precise: true });
    const other = createClient(3, false, 9, { count: 9, precise: false });
    const { base, matching, mismatched, referenceTicks } = classifyClients([
      acc1,
      acc2,
      other,
    ]);
    expect(base).toBe(acc1);
    expect(matching).toEqual([acc2]);
    expect(mismatched).toEqual([other]);
    expect(referenceTicks).toMatchObject({
      method: ReferenceSelectionMethod.ACCURATE_MODAL,
      count: 10,
    });
  });

  it('breaks ties with lowest client ID', () => {
    const acc1 = createClient(1, true, 10, { count: 10, precise: true });
    const acc2 = createClient(2, true, 10, { count: 10, precise: true });
    const acc3 = createClient(3, true, 10, { count: 10, precise: true });

    let { base } = classifyClients([acc2, acc1, acc3]);
    expect(base).toBe(acc1);

    ({ base } = classifyClients([acc3, acc2]));
    expect(base).toBe(acc2);
  });

  it('chooses the highest tick count in a multi-modal scenario', () => {
    const acc1 = createClient(1, true, 100, { count: 100, precise: true });
    const acc2 = createClient(2, true, 100, { count: 100, precise: true });
    const acc3 = createClient(3, true, 101, { count: 101, precise: true });
    const acc4 = createClient(4, true, 101, { count: 101, precise: true });
    const acc5 = createClient(5, true, 99, { count: 99, precise: true });

    const { base, matching, mismatched, referenceTicks } = classifyClients([
      acc1,
      acc2,
      acc3,
      acc4,
      acc5,
    ]);
    expect(base).toBe(acc3);
    expect(matching).toEqual([acc4]);
    expect(mismatched).toEqual(expect.arrayContaining([acc1, acc2, acc5]));
    expect(referenceTicks).toMatchObject({
      method: ReferenceSelectionMethod.ACCURATE_MODAL,
      count: 101,
    });
  });

  it('prefers a precise client if no accurate client is available', () => {
    const precise1 = createClient(1, false, 11, { count: 12, precise: true });
    const precise2 = createClient(2, false, 10, { count: 10, precise: true });
    const { base, matching, mismatched, referenceTicks } = classifyClients([
      precise1,
      precise2,
    ]);

    expect(base).toBe(precise1);
    expect(matching).toEqual([]);
    expect(mismatched).toEqual([precise2]);
    expect(referenceTicks).toMatchObject({
      method: ReferenceSelectionMethod.PRECISE_SERVER,
      count: 12,
    });
  });

  it('prefers an imprecise client if no precise client is available', () => {
    const imprecise1 = createClient(1, false, 11, {
      count: 12,
      precise: false,
    });
    const imprecise2 = createClient(2, false, 10, {
      count: 10,
      precise: false,
    });
    const { base, matching, mismatched, referenceTicks } = classifyClients([
      imprecise1,
      imprecise2,
    ]);

    expect(base).toBe(imprecise1);
    expect(matching).toEqual([]);
    expect(mismatched).toEqual([imprecise2]);
    expect(referenceTicks).toMatchObject({
      method: ReferenceSelectionMethod.IMPRECISE_SERVER,
      count: 12,
    });
  });

  it('uses highest recorded ticks if no client has server ticks', () => {
    const client1 = createClient(1, false, 11, null);
    const client2 = createClient(2, false, 10, null);
    const { base, matching, mismatched, referenceTicks } = classifyClients([
      client1,
      client2,
    ]);

    expect(base).toBe(client1);
    expect(matching).toEqual([]);
    expect(mismatched).toEqual([client2]);
    expect(referenceTicks).toMatchObject({
      method: ReferenceSelectionMethod.RECORDED_TICKS,
      count: 11,
    });
  });

  it('prefers the larger modal tick when tied', () => {
    const acc1 = createClient(1, true, 10, { count: 10, precise: true });
    const acc2 = createClient(2, true, 11, { count: 11, precise: true });
    const other = createClient(3, false, 11, { count: 11, precise: false });
    const { base, matching, mismatched, referenceTicks } = classifyClients([
      acc1,
      acc2,
      other,
    ]);
    expect(base).toBe(acc2);
    expect(matching).toEqual([]);
    expect(mismatched).toEqual(expect.arrayContaining([other, acc1]));
    expect(referenceTicks).toMatchObject({
      method: ReferenceSelectionMethod.ACCURATE_MODAL,
      count: 11,
    });
  });

  it('falls back to server tick consensus when no accurate clients are present', () => {
    const server1 = createClient(1, false, 11, { count: 11, precise: false });
    const server2 = createClient(2, false, 9, { count: 9, precise: false });
    const server3 = createClient(3, false, 11, { count: 11, precise: false });
    const other = createClient(4, false, 11, null);
    const { base, matching, mismatched, referenceTicks } = classifyClients([
      server1,
      server3,
      other,
      server2,
    ]);
    expect(base).toBe(server1);
    expect(matching).toEqual([]);
    expect(mismatched).toEqual(
      expect.arrayContaining([server3, other, server2]),
    );
    expect(referenceTicks).toMatchObject({
      method: ReferenceSelectionMethod.IMPRECISE_SERVER,
      count: 11,
    });
  });

  it('handles a server tick count of 0', () => {
    const client1 = createClient(1, false, 0, { count: 0, precise: true });
    const client2 = createClient(2, false, 10, null);
    const { base, referenceTicks } = classifyClients([client1, client2]);
    expect(base).toBe(client1);
    expect(referenceTicks).toMatchObject({
      method: ReferenceSelectionMethod.PRECISE_SERVER,
      count: 0,
    });
  });
});
