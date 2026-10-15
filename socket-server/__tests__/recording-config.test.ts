import { DataRepository } from '@blert/common';

jest.mock('fs/promises');

import { readFile } from 'fs/promises';
import { RedisClientType } from 'redis';

import { ValidationError } from '../action-definitions';
import {
  RECORDING_CONFIG_CURRENT_PUBSUB_KEY,
  RecordingConfigRepository,
  VersionError,
} from '../recording-config';

const mockedReadFile = jest.mocked(readFile);

const SEED_PATH = '/app/recording_config.json';

const seedConfig = {
  version: 1,
  challenges: [
    {
      challenge: 1,
      scope: {
        objects: [
          { type: 1, ids: [32984] },
          { type: 3, ids: [1570, 1571, 1572, 1573, 1576], onCreation: true },
        ],
      },
    },
    {
      challenge: 4,
      scope: {
        objects: [{ type: 2, ids: [50744] }],
      },
    },
    {
      challenge: 6,
      scope: {
        objects: [{ type: 1, ids: [57283, 57286] }],
      },
    },
  ],
};

const version2Config = {
  version: 2,
  challenges: [
    {
      challenge: 1,
      scope: {
        objects: [
          { type: 1, ids: [32984] },
          { type: 3, ids: [1579, 1595] },
        ],
      },
    },
  ],
};

class FakeDataRepository {
  public readonly files = new Map<string, string>();

  public async loadRaw(path: string): Promise<Uint8Array> {
    const contents = this.files.get(path);
    if (contents === undefined) {
      throw new DataRepository.NotFound(path);
    }
    return new TextEncoder().encode(contents);
  }

  public async saveRaw(path: string, contents: Uint8Array): Promise<void> {
    this.files.set(path, new TextDecoder().decode(contents));
  }

  public async listFiles(path: string): Promise<string[]> {
    return [...this.files.keys()].filter((file) => file.startsWith(path));
  }

  public json(path: string): unknown {
    const contents = this.files.get(path);
    return contents === undefined ? undefined : JSON.parse(contents);
  }
}

function setup() {
  mockedReadFile.mockReset();
  mockedReadFile.mockImplementation((path) =>
    path === SEED_PATH
      ? Promise.resolve(JSON.stringify(seedConfig))
      : Promise.reject(new Error('ENOENT')),
  );
  const repository = new FakeDataRepository();
  const redis = { publish: jest.fn().mockResolvedValue(1) };
  const recordingConfigRepository = new RecordingConfigRepository(
    repository as unknown as DataRepository,
    redis as unknown as RedisClientType,
  );
  return { repository, redis, recordingConfigRepository };
}

function currentVersion(repo: RecordingConfigRepository): number | undefined {
  return repo.createRecordingConfigMessage().getRecordingConfig()?.getVersion();
}

describe('RecordingConfigRepository', () => {
  describe('initialize', () => {
    it('seeds an empty repository from a configured file', async () => {
      const { repository, redis, recordingConfigRepository } = setup();

      await recordingConfigRepository.initialize(SEED_PATH);

      expect([...repository.files.keys()].sort()).toEqual([
        'recording-config/current.json',
        'recording-config/v1.json',
      ]);
      expect(repository.json('recording-config/v1.json')).toEqual(seedConfig);
      expect(repository.json('recording-config/current.json')).toEqual({
        version: 1,
      });
      const config = recordingConfigRepository
        .createRecordingConfigMessage()
        .getRecordingConfig()!;
      expect(config.getVersion()).toBe(1);
      expect(config.getChallengesList().map((c) => c.getChallenge())).toEqual([
        1, 4, 6,
      ]);
      expect(redis.publish).not.toHaveBeenCalled();
    });

    it('loads the current version without reading the seed file', async () => {
      const { repository, recordingConfigRepository } = setup();
      repository.files.set(
        'recording-config/v1.json',
        JSON.stringify(seedConfig),
      );
      repository.files.set(
        'recording-config/v2.json',
        JSON.stringify(version2Config),
      );
      repository.files.set(
        'recording-config/current.json',
        JSON.stringify({ version: 2 }),
      );

      await recordingConfigRepository.initialize(SEED_PATH);

      expect(currentVersion(recordingConfigRepository)).toBe(2);
      expect(repository.json('recording-config/current.json')).toEqual({
        version: 2,
      });
      expect(mockedReadFile).not.toHaveBeenCalled();
    });

    it('fails if the current version does not reference a valid file', async () => {
      const { repository, recordingConfigRepository } = setup();
      repository.files.set(
        'recording-config/current.json',
        JSON.stringify({ version: 3 }),
      );

      await expect(
        recordingConfigRepository.initialize(SEED_PATH),
      ).rejects.toThrow(DataRepository.NotFound);
      expect(repository.files.has('recording-config/v1.json')).toBe(false);
    });

    it('fails if versions exist without a current version', async () => {
      const { repository, recordingConfigRepository } = setup();
      repository.files.set(
        'recording-config/v2.json',
        JSON.stringify(version2Config),
      );

      await expect(
        recordingConfigRepository.initialize(SEED_PATH),
      ).rejects.toThrow(
        'Recording config repository has versions but no current version',
      );
      expect([...repository.files.keys()]).toEqual([
        'recording-config/v2.json',
      ]);
    });
  });

  it('throws if a proto message is created before initialization', () => {
    const { recordingConfigRepository } = setup();

    expect(() =>
      recordingConfigRepository.createRecordingConfigMessage(),
    ).toThrow('Recording config repository is not initialized');
  });

  describe('upload', () => {
    it('saves a new version without updating the current version', async () => {
      const { repository, redis, recordingConfigRepository } = setup();
      await recordingConfigRepository.initialize(SEED_PATH);

      const uploaded = await recordingConfigRepository.upload(version2Config);

      expect(uploaded).toEqual(version2Config);
      expect(repository.json('recording-config/v2.json')).toEqual(
        version2Config,
      );
      expect(repository.json('recording-config/current.json')).toEqual({
        version: 1,
      });
      expect(currentVersion(recordingConfigRepository)).toBe(1);
      expect(redis.publish).not.toHaveBeenCalled();
    });

    it('rejects a version that has already been uploaded', async () => {
      const { repository, recordingConfigRepository } = setup();
      await recordingConfigRepository.initialize(SEED_PATH);

      await expect(
        recordingConfigRepository.upload({ ...version2Config, version: 1 }),
      ).rejects.toThrow(new VersionError(1));
      expect(repository.json('recording-config/v1.json')).toEqual(seedConfig);
    });

    it('rejects an invalid config', async () => {
      const { repository, recordingConfigRepository } = setup();
      await recordingConfigRepository.initialize(SEED_PATH);

      await expect(
        recordingConfigRepository.upload({ version: 4 }),
      ).rejects.toThrow(ValidationError);
      await expect(
        recordingConfigRepository.upload({
          version: 4294967296,
          challenges: [],
        }),
      ).rejects.toThrow(ValidationError);
      await expect(
        recordingConfigRepository.upload({
          version: 5,
          challenges: [
            {
              challenge: 1,
              scope: { objects: [{ type: 1, ids: [4294967296] }] },
            },
          ],
        }),
      ).rejects.toThrow(ValidationError);
      await expect(
        recordingConfigRepository.upload({
          version: 6,
          challenges: [
            { challenge: 1, scope: { objects: [{ type: 9, ids: [32984] }] } },
          ],
        }),
      ).rejects.toThrow(ValidationError);
      await expect(
        recordingConfigRepository.upload({
          version: 7,
          challenges: [
            { challenge: 12, scope: { objects: [{ type: 1, ids: [32984] }] } },
          ],
        }),
      ).rejects.toThrow(ValidationError);
      expect([...repository.files.keys()].sort()).toEqual([
        'recording-config/current.json',
        'recording-config/v1.json',
      ]);
    });
  });

  describe('setCurrentVersion', () => {
    it('sets an uploaded version current and publishes an update message', async () => {
      const { repository, redis, recordingConfigRepository } = setup();
      await recordingConfigRepository.initialize(SEED_PATH);
      await recordingConfigRepository.upload(version2Config);

      await recordingConfigRepository.setCurrentVersion(2);

      expect(repository.json('recording-config/current.json')).toEqual({
        version: 2,
      });
      expect(currentVersion(recordingConfigRepository)).toBe(1);
      expect(redis.publish).toHaveBeenCalledTimes(1);
      expect(redis.publish).toHaveBeenCalledWith(
        RECORDING_CONFIG_CURRENT_PUBSUB_KEY,
        JSON.stringify({ version: 2 }),
      );
    });

    it('fails if the requested version does not exist', async () => {
      const { repository, redis, recordingConfigRepository } = setup();
      await recordingConfigRepository.initialize(SEED_PATH);

      await expect(
        recordingConfigRepository.setCurrentVersion(5),
      ).rejects.toThrow(new VersionError(5));
      expect(repository.json('recording-config/current.json')).toEqual({
        version: 1,
      });
      expect(currentVersion(recordingConfigRepository)).toBe(1);
      expect(redis.publish).not.toHaveBeenCalled();
    });
  });

  describe('loadCurrent', () => {
    it('loads the current version if it has changed', async () => {
      const { repository, recordingConfigRepository } = setup();
      await recordingConfigRepository.initialize(SEED_PATH);

      await expect(recordingConfigRepository.loadCurrent()).resolves.toBe(
        false,
      );
      expect(currentVersion(recordingConfigRepository)).toBe(1);

      repository.files.set(
        'recording-config/v2.json',
        JSON.stringify(version2Config),
      );
      repository.files.set(
        'recording-config/current.json',
        JSON.stringify({ version: 2 }),
      );

      await expect(recordingConfigRepository.loadCurrent()).resolves.toBe(true);
      expect(currentVersion(recordingConfigRepository)).toBe(2);
    });
  });
});
