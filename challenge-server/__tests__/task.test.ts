import { IntervalTask, PendingTasks } from '../task';

describe('IntervalTask', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('runs repeatedly, waiting for the configured interval between runs', async () => {
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

  test('stop() waits for an in-flight run before resolving', async () => {
    let releaseRun: (() => void) | null = null;
    const tick = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseRun = resolve;
        }),
    );
    const task = new IntervalTask(tick, { intervalMs: 500 });
    task.start();

    // The first run begins and parks on the unresolved promise.
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

  test('stop() cancels a scheduled run that has not started', async () => {
    const tick = jest.fn(() => Promise.resolve());
    const task = new IntervalTask(tick, { intervalMs: 500 });
    task.start();

    await task.stop();

    await jest.advanceTimersByTimeAsync(2000);
    expect(tick).not.toHaveBeenCalled();
  });

  test('reports a thrown error and keeps looping', async () => {
    const error = new Error('boom');
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

  test('start() is idempotent', async () => {
    const tick = jest.fn(() => Promise.resolve());
    const task = new IntervalTask(tick, { intervalMs: 500 });
    task.start();
    task.start();

    await jest.advanceTimersByTimeAsync(500);
    expect(tick).toHaveBeenCalledTimes(1);

    await task.stop();
  });
});

describe('PendingTasks', () => {
  test('drain() waits for an in-flight task before resolving', async () => {
    const tasks = new PendingTasks();
    let release: (() => void) | null = null;
    tasks.add(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );

    let drained = false;
    const draining = tasks.drain().then(() => {
      drained = true;
    });

    await Promise.resolve();
    expect(drained).toBe(false);
    expect(tasks.size).toBe(1);

    release!();
    await draining;
    expect(drained).toBe(true);
  });

  test('settled tasks are removed from the set', async () => {
    const tasks = new PendingTasks();
    const task = Promise.resolve();
    tasks.add(task);

    await task;
    await Promise.resolve();

    expect(tasks.size).toBe(0);
  });

  test('drain() tolerates a rejected task without throwing', async () => {
    const tasks = new PendingTasks();
    tasks.add(Promise.reject(new Error('boom')));

    await expect(tasks.drain()).resolves.toBeUndefined();
    expect(tasks.size).toBe(0);
  });

  test('drain() with no tasks resolves immediately', async () => {
    const tasks = new PendingTasks();
    await expect(tasks.drain()).resolves.toBeUndefined();
  });

  test('drain() awaits every tracked task', async () => {
    const tasks = new PendingTasks();
    const releases: (() => void)[] = [];
    for (let i = 0; i < 3; i++) {
      tasks.add(
        new Promise<void>((resolve) => {
          releases.push(resolve);
        }),
      );
    }
    expect(tasks.size).toBe(3);

    let drained = false;
    const draining = tasks.drain().then(() => {
      drained = true;
    });

    releases[0]();
    releases[1]();
    await Promise.resolve();
    expect(drained).toBe(false);

    releases[2]();
    await draining;
    expect(drained).toBe(true);
  });
});
