import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from '@jest/globals';

import { IntervalTask } from '../task';

describe('IntervalTask', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('runs repeatedly, waiting the configured interval between runs', async () => {
    const tick = jest.fn(() => Promise.resolve());
    const task = new IntervalTask(tick, { intervalMs: 500 });
    task.start();

    expect(tick).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(500);
    expect(tick).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(500);
    expect(tick).toHaveBeenCalledTimes(2);

    // Three more runs land over the next 1.5s.
    await jest.advanceTimersByTimeAsync(1500);
    expect(tick).toHaveBeenCalledTimes(5);

    await task.stop();
  });

  test('does nothing if restarted', async () => {
    const tick = jest.fn(() => Promise.resolve());
    const task = new IntervalTask(tick, { intervalMs: 500 });
    task.start();
    task.start();

    await jest.advanceTimersByTimeAsync(500);
    expect(tick).toHaveBeenCalledTimes(1);

    await task.stop();
  });

  describe('stop', () => {
    test('waits for an in-flight run before resolving', async () => {
      let releaseRun: (() => void) | null = null;
      const tick = jest.fn(
        () =>
          new Promise<void>((resolve) => {
            releaseRun = resolve;
          }),
      );
      const task = new IntervalTask(tick, { intervalMs: 500 });
      task.start();

      await jest.advanceTimersByTimeAsync(500);
      expect(tick).toHaveBeenCalledTimes(1);
      expect(releaseRun).not.toBeNull();

      let stopped = false;
      const stopPromise = task.stop().then(() => {
        stopped = true;
      });

      await Promise.resolve();
      expect(stopped).toBe(false);

      releaseRun!();
      await stopPromise;
      expect(stopped).toBe(true);

      // No further run is scheduled once the in-flight one drains.
      await jest.advanceTimersByTimeAsync(2000);
      expect(tick).toHaveBeenCalledTimes(1);
    });

    test('cancels a scheduled run that has not started', async () => {
      const tick = jest.fn(() => Promise.resolve());
      const task = new IntervalTask(tick, { intervalMs: 500 });
      task.start();

      await task.stop();

      await jest.advanceTimersByTimeAsync(2000);
      expect(tick).not.toHaveBeenCalled();
    });
  });

  test('reports a thrown error and keeps looping', async () => {
    const error = new Error('splat');
    let calls = 0;
    const tick = jest.fn(async () => {
      calls += 1;
      if (calls === 1) {
        throw error;
      }
    });
    const onError = jest.fn();
    const task = new IntervalTask(tick, { intervalMs: 500, onError });
    task.start();

    await jest.advanceTimersByTimeAsync(500);
    expect(onError).toHaveBeenCalledWith(error);

    await jest.advanceTimersByTimeAsync(500);
    expect(tick).toHaveBeenCalledTimes(2);

    await task.stop();
  });
});
