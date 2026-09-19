import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';

import { EffectEventKind } from '../../effects';
import { EffectStore, Subscription } from '../store';
import { Sweeper } from '../sweep';

const SUBSCRIPTIONS: Subscription[] = [
  { kind: EffectEventKind.CHALLENGE_FINISHED, handler: 'feed' },
];
const INTERVAL_MS = 60 * 60 * 1000;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

function makeStore() {
  return {
    sweepEvents: jest.fn<EffectStore['sweepEvents']>().mockResolvedValue(0),
  };
}

describe('Sweeper', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-09-19T12:00:00Z') });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('sweeps events older than the retention period on start', async () => {
    const store = makeStore();
    const sweeper = new Sweeper(
      store as unknown as EffectStore,
      SUBSCRIPTIONS,
      INTERVAL_MS,
      RETENTION_MS,
    );

    await sweeper.start();
    await sweeper.stop();

    expect(store.sweepEvents.mock.calls).toEqual([
      [SUBSCRIPTIONS, new Date('2026-09-12T12:00:00Z')],
    ]);
  });

  it('sweeps again after each configured interval', async () => {
    const store = makeStore();
    const sweeper = new Sweeper(
      store as unknown as EffectStore,
      SUBSCRIPTIONS,
      INTERVAL_MS,
      RETENTION_MS,
    );

    await sweeper.start();
    await jest.advanceTimersByTimeAsync(INTERVAL_MS);
    await jest.advanceTimersByTimeAsync(INTERVAL_MS);
    await sweeper.stop();

    expect(store.sweepEvents.mock.calls).toEqual([
      [SUBSCRIPTIONS, new Date('2026-09-12T12:00:00Z')],
      [SUBSCRIPTIONS, new Date('2026-09-12T13:00:00Z')],
      [SUBSCRIPTIONS, new Date('2026-09-12T14:00:00Z')],
    ]);
  });

  it('contiues sweeping after a failure', async () => {
    const store = makeStore();
    store.sweepEvents.mockRejectedValueOnce(new Error('connection closed'));
    const sweeper = new Sweeper(
      store as unknown as EffectStore,
      SUBSCRIPTIONS,
      INTERVAL_MS,
      RETENTION_MS,
    );

    await expect(sweeper.start()).resolves.toBeUndefined();
    await jest.advanceTimersByTimeAsync(INTERVAL_MS);
    await sweeper.stop();

    expect(store.sweepEvents).toHaveBeenCalledTimes(2);
  });

  it('stops sweeping once stopped', async () => {
    const store = makeStore();
    const sweeper = new Sweeper(
      store as unknown as EffectStore,
      SUBSCRIPTIONS,
      INTERVAL_MS,
      RETENTION_MS,
    );

    await sweeper.start();
    await sweeper.stop();
    await jest.advanceTimersByTimeAsync(3 * INTERVAL_MS);

    expect(store.sweepEvents).toHaveBeenCalledTimes(1);
  });
});
