import { RedisClientType } from 'redis';

import {
  PluginVersions,
  verifyRevision,
  verifyRuneLiteVersion,
} from './verification';

type Config = {
  minRuneLiteVersion: string | null;
  allowedRevisions: Set<string>;
};

export class ConfigManager {
  private static readonly TTL_MS: number = 5 * 1000;
  private static readonly REVISION_KEY: string = 'blert:allowed-revisions';
  private static readonly RL_VERSION_KEY: string = 'blert:min-rl-version';

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
    return (
      verifyRevision(config.allowedRevisions, pluginVersions.getRevision()) &&
      verifyRuneLiteVersion(
        pluginVersions.getRuneLiteVersion(),
        config.minRuneLiteVersion,
      )
    );
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
        console.error('Failed to get config from Redis:', e);
        this.expiry = Date.now() + ConfigManager.TTL_MS / 2;
      } finally {
        this.request = null;
      }
    })();

    await this.request;
    return this.config;
  }

  private async refresh() {
    const [redisRevisions, redisRlVersion] = await Promise.all([
      this.redis.sMembers(ConfigManager.REVISION_KEY),
      this.redis.get(ConfigManager.RL_VERSION_KEY),
    ]);

    if (redisRevisions.length > 0) {
      const newRevisions = new Set(redisRevisions);
      const revisionsMatch =
        newRevisions.size === this.config.allowedRevisions.size &&
        newRevisions.isSubsetOf(this.config.allowedRevisions);
      if (!revisionsMatch) {
        console.log('Updating allowed revisions:', redisRevisions.join(', '));
        this.config.allowedRevisions = newRevisions;
      }
    }

    if (
      redisRlVersion !== null &&
      redisRlVersion !== this.config.minRuneLiteVersion
    ) {
      console.log('Updating min RuneLite version:', redisRlVersion);
      this.config.minRuneLiteVersion = redisRlVersion;
    }
  }
}
