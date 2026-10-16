import {
  DataRepository,
  RecordingConfigJson,
  recordingConfigJsonToProto,
  recordingConfigSchema,
} from '@blert/common';
import {
  RecordingConfig,
  ServerMessage,
} from '@blert/common/generated/server_message_pb';
import { readFile } from 'fs/promises';
import { RedisClientType } from 'redis';
import { z } from 'zod';

import { ValidationError } from './action-definitions';
import logger from './log';

export class VersionError extends Error {
  constructor(version: number) {
    super(`Invalid recording config version: ${version}`);
    this.name = 'VersionError';
  }
}

export const RECORDING_CONFIG_CURRENT_PUBSUB_KEY = 'recording-config-current';

const currentVersionSchema = z.object({
  version: z.number().int().nonnegative(),
});

type CurrentRecordingConfigVersion = z.infer<typeof currentVersionSchema>;

const CURRENT_PATH = 'recording-config/current.json';

function versionPath(version: number): string {
  return `recording-config/v${version}.json`;
}

function encodeJson(data: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(data, null, 2));
}

function decodeJson(data: Uint8Array): unknown {
  return JSON.parse(new TextDecoder().decode(data));
}

export function validateRecordingConfig(data: unknown): RecordingConfigJson {
  const result = recordingConfigSchema.safeParse(data);
  if (!result.success) {
    throw ValidationError.fromIssue(result.error.issues[0]);
  }
  return result.data;
}

export class RecordingConfigRepository {
  private repository: DataRepository;
  private redis: RedisClientType;
  private config: RecordingConfig | null = null;

  public constructor(repository: DataRepository, redis: RedisClientType) {
    this.repository = repository;
    this.redis = redis;
  }

  /**
   * Loads the current config version. If the repository has no current
   * version, seeds one from the config file at `seedPath` first.
   */
  public async initialize(seedPath: string): Promise<void> {
    let current: CurrentRecordingConfigVersion;
    try {
      current = await this.readCurrent();
    } catch (e) {
      if (!(e instanceof DataRepository.NotFound)) {
        throw e;
      }
      current = await this.seed(seedPath);
    }
    await this.load(current.version);
  }

  /**
   * Loads the current version of the config.
   *
   * @returns Whether the current version differs from the loaded one.
   */
  public async loadCurrent(): Promise<boolean> {
    const { version } = await this.readCurrent();
    if (this.config !== null && this.config.getVersion() === version) {
      return false;
    }
    await this.load(version);
    return true;
  }

  /**
   * Uploads a new config version without changing the current version.
   *
   * @throws ValidationError if the config is invalid, or VersionError if its
   * version already exists.
   */
  public async upload(config: unknown): Promise<RecordingConfigJson> {
    const validated = validateRecordingConfig(config);
    const path = versionPath(validated.version);

    if (await this.exists(path)) {
      throw new VersionError(validated.version);
    }

    await this.repository.saveRaw(path, encodeJson(validated));
    logger.info('recording_config_uploaded', { version: validated.version });
    return validated;
  }

  /**
   * Sets an uploaded version as the current version and notifies every
   * instance to send it to its connected clients.
   *
   * @throws VersionError if the version does not exist.
   */
  public async setCurrentVersion(version: number): Promise<void> {
    try {
      await this.loadVersion(version);
    } catch (e) {
      if (e instanceof DataRepository.NotFound) {
        throw new VersionError(version);
      }
      throw e;
    }

    const current: CurrentRecordingConfigVersion = { version };
    await this.repository.saveRaw(CURRENT_PATH, encodeJson(current));
    await this.redis.publish(
      RECORDING_CONFIG_CURRENT_PUBSUB_KEY,
      JSON.stringify(current),
    );
    logger.info('recording_config_current_version_set', { version });
  }

  /**
   * Creates a ServerMessage containing the current config.
   *
   * @throws Error if called before `initialize`.
   */
  public createRecordingConfigMessage(): ServerMessage {
    if (this.config === null) {
      throw new Error('Recording config repository is not initialized');
    }
    const message = new ServerMessage();
    message.setType(ServerMessage.Type.RECORDING_CONFIG);
    message.setRecordingConfig(this.config);
    return message;
  }

  private async seed(seedPath: string): Promise<CurrentRecordingConfigVersion> {
    if ((await this.repository.listFiles('recording-config/')).length > 0) {
      throw new Error(
        'Recording config repository has versions but no current version',
      );
    }
    const config = validateRecordingConfig(
      JSON.parse(await readFile(seedPath, 'utf8')),
    );
    await this.repository.saveRaw(
      versionPath(config.version),
      encodeJson(config),
    );
    const current: CurrentRecordingConfigVersion = { version: config.version };
    await this.repository.saveRaw(CURRENT_PATH, encodeJson(current));
    logger.info('recording_config_seeded', {
      version: config.version,
      seedPath,
    });
    return current;
  }

  private async load(version: number): Promise<void> {
    this.config = recordingConfigJsonToProto(await this.loadVersion(version));
    logger.info('recording_config_loaded', { version });
  }

  private async readCurrent(): Promise<CurrentRecordingConfigVersion> {
    const data = await this.repository.loadRaw(CURRENT_PATH);
    return currentVersionSchema.parse(decodeJson(data));
  }

  private async loadVersion(version: number): Promise<RecordingConfigJson> {
    const data = await this.repository.loadRaw(versionPath(version));
    return validateRecordingConfig(decodeJson(data));
  }

  private async exists(path: string): Promise<boolean> {
    try {
      await this.repository.loadRaw(path);
      return true;
    } catch (e) {
      if (e instanceof DataRepository.NotFound) {
        return false;
      }
      throw e;
    }
  }
}
