import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';

import { ChallengeMode, ChallengeType } from '@blert/common';
import { RedisClientType } from 'redis';

import { Config, ConfigManager } from '../config';

const DISABLED_CHALLENGES_KEY = 'blert:disabled-challenges';

class FakeMulti {
  private readonly ops: (() => unknown)[] = [];

  public constructor(private readonly redis: FakeRedisClient) {}

  public sMembers(key: string): this {
    this.ops.push(() => this.redis.sMembers(key));
    return this;
  }

  public get(key: string): this {
    this.ops.push(() => this.redis.get(key));
    return this;
  }

  public async exec(): Promise<unknown[]> {
    return this.ops.map((op) => op());
  }
}

class FakeRedisClient {
  public readonly sets = new Map<string, Set<string>>();
  public readonly strings = new Map<string, string>();

  public multi(): FakeMulti {
    return new FakeMulti(this);
  }

  public sMembers(key: string): string[] {
    return Array.from(this.sets.get(key) ?? []);
  }

  public get(key: string): string | null {
    return this.strings.get(key) ?? null;
  }
}

function createFakeConfig(initial: Partial<Config> = {}) {
  const redis = new FakeRedisClient();
  const config = new ConfigManager(redis as unknown as RedisClientType, {
    minRuneLiteVersion: null,
    allowedRevisions: new Set(),
    disabledChallenges: new Set(),
    ...initial,
  });

  /** Writes a Redis set, expiring the manager's cached config. */
  const setKey = (key: string, members: string[]) => {
    redis.sets.set(key, new Set(members));
    jest.advanceTimersByTime(60 * 1000);
  };

  return { config, setKey };
}

describe('isRecordingEnabled', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const allChallenges: [ChallengeType, ChallengeMode][] = [
    [ChallengeType.TOB, ChallengeMode.TOB_ENTRY],
    [ChallengeType.TOB, ChallengeMode.TOB_REGULAR],
    [ChallengeType.TOB, ChallengeMode.TOB_HARD],
    [ChallengeType.COX, ChallengeMode.NO_MODE],
    [ChallengeType.TOA, ChallengeMode.NO_MODE],
    [ChallengeType.COLOSSEUM, ChallengeMode.NO_MODE],
    [ChallengeType.INFERNO, ChallengeMode.NO_MODE],
    [ChallengeType.MOKHAIOTL, ChallengeMode.NO_MODE],
  ];

  it('allows every challenge and mode when nothing is disabled', async () => {
    const { config } = createFakeConfig();

    for (const [type, mode] of allChallenges) {
      await expect(config.isRecordingEnabled(type, mode)).resolves.toBe(true);
    }
  });

  it('disallows all starts when a challenge type is disabled', async () => {
    const { config, setKey } = createFakeConfig();
    setKey(DISABLED_CHALLENGES_KEY, ['colosseum', 'tob']);

    await expect(
      config.isRecordingEnabled(ChallengeType.COLOSSEUM, ChallengeMode.NO_MODE),
    ).resolves.toBe(false);
    await expect(
      config.isRecordingEnabled(ChallengeType.TOB, ChallengeMode.TOB_ENTRY),
    ).resolves.toBe(false);
    await expect(
      config.isRecordingEnabled(ChallengeType.TOB, ChallengeMode.TOB_HARD),
    ).resolves.toBe(false);
  });

  it('only disallows the configured types', async () => {
    const { config, setKey } = createFakeConfig();
    setKey(DISABLED_CHALLENGES_KEY, ['colosseum']);

    await expect(
      config.isRecordingEnabled(ChallengeType.INFERNO, ChallengeMode.NO_MODE),
    ).resolves.toBe(true);
    await expect(
      config.isRecordingEnabled(ChallengeType.MOKHAIOTL, ChallengeMode.NO_MODE),
    ).resolves.toBe(true);
    await expect(
      config.isRecordingEnabled(ChallengeType.TOB, ChallengeMode.TOB_REGULAR),
    ).resolves.toBe(true);
  });

  it('disallows a specific challenge mode', async () => {
    const { config, setKey } = createFakeConfig();
    setKey(DISABLED_CHALLENGES_KEY, ['tob:entry']);

    await expect(
      config.isRecordingEnabled(ChallengeType.TOB, ChallengeMode.TOB_ENTRY),
    ).resolves.toBe(false);
    await expect(
      config.isRecordingEnabled(ChallengeType.TOB, ChallengeMode.TOB_REGULAR),
    ).resolves.toBe(true);
    await expect(
      config.isRecordingEnabled(ChallengeType.TOB, ChallengeMode.TOB_HARD),
    ).resolves.toBe(true);
  });

  it('ignores whitespace and case in entries', async () => {
    const { config, setKey } = createFakeConfig();
    setKey(DISABLED_CHALLENGES_KEY, [' COLOSSEUM ', 'TOB:Entry']);

    await expect(
      config.isRecordingEnabled(ChallengeType.COLOSSEUM, ChallengeMode.NO_MODE),
    ).resolves.toBe(false);
    await expect(
      config.isRecordingEnabled(ChallengeType.TOB, ChallengeMode.TOB_ENTRY),
    ).resolves.toBe(false);
  });

  it('ignores entries that are not valid challenges', async () => {
    const { config, setKey } = createFakeConfig();
    setKey(DISABLED_CHALLENGES_KEY, ['colloseum', 'tob:', 'tob:harderer', '']);

    await expect(
      config.isRecordingEnabled(ChallengeType.COLOSSEUM, ChallengeMode.NO_MODE),
    ).resolves.toBe(true);
    await expect(
      config.isRecordingEnabled(ChallengeType.TOB, ChallengeMode.TOB_HARD),
    ).resolves.toBe(true);
  });

  it('picks up challenges disabled while running', async () => {
    const { config, setKey } = createFakeConfig();

    await expect(
      config.isRecordingEnabled(ChallengeType.INFERNO, ChallengeMode.NO_MODE),
    ).resolves.toBe(true);

    setKey(DISABLED_CHALLENGES_KEY, ['inferno']);

    await expect(
      config.isRecordingEnabled(ChallengeType.INFERNO, ChallengeMode.NO_MODE),
    ).resolves.toBe(false);
  });

  it('re-enables all challenges if the set is cleared', async () => {
    const { config, setKey } = createFakeConfig();
    setKey(DISABLED_CHALLENGES_KEY, [
      'colosseum',
      'inferno',
      'mokhaiotl',
      'tob:entry',
    ]);

    await expect(
      config.isRecordingEnabled(ChallengeType.INFERNO, ChallengeMode.NO_MODE),
    ).resolves.toBe(false);

    setKey(DISABLED_CHALLENGES_KEY, []);

    for (const [type, mode] of allChallenges) {
      await expect(config.isRecordingEnabled(type, mode)).resolves.toBe(true);
    }
  });
});
