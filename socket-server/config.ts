import { ChallengeMode, ChallengeType } from '@blert/common';
import { RedisClientType } from 'redis';

import {
  PluginVersions,
  verifyRevision,
  verifyRuneLiteVersion,
} from './verification';
import logger from './log';

export type Config = {
  minRuneLiteVersion: string | null;
  allowedRevisions: Set<string>;
  disabledChallenges: Set<string>;
};

const CHALLENGE_TYPE_KEYS: ReadonlyMap<ChallengeType, string> = new Map(
  Object.entries(ChallengeType)
    .filter(([, value]) => typeof value === 'number')
    .map(([name, value]) => [value as ChallengeType, name.toLowerCase()]),
);

const DISABLEABLE_MODES: readonly (readonly [
  ChallengeType,
  ChallengeMode,
  string,
])[] = [
  [ChallengeType.TOB, ChallengeMode.TOB_ENTRY, 'entry'],
  [ChallengeType.TOB, ChallengeMode.TOB_REGULAR, 'regular'],
  [ChallengeType.TOB, ChallengeMode.TOB_HARD, 'hard'],
];

const MODE_KEYS: ReadonlyMap<ChallengeMode, string> = new Map(
  DISABLEABLE_MODES.map(([, mode, key]) => [mode, key]),
);

/**
 * Returns a string key that indicates whether a specific challenge and mode
 * pair is disabled.
 */
function disabledChallengeKey(
  type: ChallengeType,
  mode?: ChallengeMode,
): string | null {
  const typeKey = CHALLENGE_TYPE_KEYS.get(type);
  if (typeKey === undefined) {
    return null;
  }
  if (mode === undefined) {
    return typeKey;
  }

  const modeKey = MODE_KEYS.get(mode);
  if (modeKey === undefined) {
    return null;
  }
  return `${typeKey}:${modeKey}`;
}

const VALID_DISABLED_CHALLENGES: ReadonlySet<string> = new Set([
  ...CHALLENGE_TYPE_KEYS.values(),
  ...DISABLEABLE_MODES.map(([type, mode]) => disabledChallengeKey(type, mode)!),
]);

export class ConfigManager {
  private static readonly TTL_MS: number = 5 * 1000;
  private static readonly REVISION_KEY: string = 'blert:allowed-revisions';
  private static readonly RL_VERSION_KEY: string = 'blert:min-rl-version';
  private static readonly DISABLED_CHALLENGES_KEY: string =
    'blert:disabled-challenges';

  private redis: RedisClientType;
  private config: Config;
  private expiry: number;

  private request: Promise<void> | null;

  public constructor(redis: RedisClientType, initialConfig: Config) {
    this.redis = redis;
    this.config = initialConfig;
    this.expiry = 0;
    this.request = null;
  }

  /**
   * Verify that a plugin revision and RuneLite version are valid.
   *
   * @param revision The revision to verify.
   * @param version The version to verify.
   * @returns True if the revision and version are valid.
   */
  public async verify(pluginVersions: PluginVersions): Promise<boolean> {
    const config = await this.get();
    const isVersionValid =
      /^\d+\.\d+\.\d+(-RUNELITE|-SNAPSHOT|-dev)?$/.exec(
        pluginVersions.getVersion(),
      ) !== null;
    return (
      isVersionValid &&
      verifyRevision(
        config.allowedRevisions,
        pluginVersions.getRevision(),
        pluginVersions.getJarHash(),
      ) &&
      verifyRuneLiteVersion(
        pluginVersions.getRuneLiteVersion(),
        config.minRuneLiteVersion,
      )
    );
  }

  /**
   * Checks whether recording for a specific challenge type and mode is active.
   *
   * @param type The challenge type.
   * @param mode The mode of the challenge.
   * @returns True if recording is active.
   */
  public async isRecordingEnabled(
    type: ChallengeType,
    mode: ChallengeMode,
  ): Promise<boolean> {
    const config = await this.get();
    if (config.disabledChallenges.size === 0) {
      return true;
    }

    const typeKey = disabledChallengeKey(type);
    if (typeKey !== null && config.disabledChallenges.has(typeKey)) {
      return false;
    }

    const modeKey = disabledChallengeKey(type, mode);
    return modeKey === null || !config.disabledChallenges.has(modeKey);
  }

  private async get(): Promise<Config> {
    const now = Date.now();
    if (now < this.expiry) {
      return this.config;
    }

    this.request ??= (async () => {
      try {
        await this.refresh();
        this.expiry = Date.now() + ConfigManager.TTL_MS;
      } catch (e) {
        logger.error('config_refresh_failed', {
          error: e instanceof Error ? e : new Error(String(e)),
        });
        this.expiry = Date.now() + ConfigManager.TTL_MS / 2;
      } finally {
        this.request = null;
      }
    })();

    await this.request;
    return this.config;
  }

  private async refresh() {
    const results = await this.redis
      .multi()
      .sMembers(ConfigManager.REVISION_KEY)
      .get(ConfigManager.RL_VERSION_KEY)
      .sMembers(ConfigManager.DISABLED_CHALLENGES_KEY)
      .exec();
    if (results === null) {
      throw new Error('Config transaction was aborted');
    }

    const redisRevisions = results[0] as string[];
    const redisRlVersion = results[1] as string | null;
    const redisDisabledChallenges = results[2] as string[];

    if (redisRevisions.length > 0) {
      const newRevisions = new Set(redisRevisions);
      const revisionsMatch =
        newRevisions.size === this.config.allowedRevisions.size &&
        newRevisions.isSubsetOf(this.config.allowedRevisions);
      if (!revisionsMatch) {
        logger.info('config_allowed_revisions_updated', {
          revisions: Array.from(newRevisions),
        });
        this.config.allowedRevisions = newRevisions;
      }
    }

    if (
      redisRlVersion !== null &&
      redisRlVersion !== this.config.minRuneLiteVersion
    ) {
      logger.info('config_min_runelite_version_updated', {
        minRuneLiteVersion: redisRlVersion,
      });
      this.config.minRuneLiteVersion = redisRlVersion;
    }

    const newDisabledChallenges = new Set(
      redisDisabledChallenges
        .map((entry) => entry.trim().toLowerCase())
        .filter((entry) => VALID_DISABLED_CHALLENGES.has(entry)),
    );
    const disabledChallengesMatch =
      newDisabledChallenges.size === this.config.disabledChallenges.size &&
      newDisabledChallenges.isSubsetOf(this.config.disabledChallenges);
    if (!disabledChallengesMatch) {
      logger.info('config_disabled_challenges_updated', {
        disabledChallenges: Array.from(newDisabledChallenges),
      });
      this.config.disabledChallenges = newDisabledChallenges;
    }
  }
}
