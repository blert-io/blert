/* eslint-disable @typescript-eslint/unbound-method */
import { DataRepository } from '@blert/common';
import { ServerMessage } from '@blert/common/generated/server_message_pb';

jest.mock('fs/promises');

import { readFile } from 'fs/promises';
import {
  AttackRepository,
  AttackDefinitionJson,
  ValidationError,
  validateDefinitions,
} from '../attack-definitions';

const mockedReadFile = jest.mocked(readFile);

const validDefinition: AttackDefinitionJson = {
  protoId: 1,
  name: 'Test Attack',
  weaponIds: [1234],
  animationIds: [100],
  cooldown: 4,
  category: 'MELEE',
};

const validDefinitions: AttackDefinitionJson[] = [
  validDefinition,
  {
    protoId: 2,
    name: 'Ranged Attack',
    weaponIds: [5678],
    animationIds: [200],
    cooldown: 3,
    category: 'RANGED',
    projectile: { id: 500, startCycleOffset: 30 },
  },
];

function createMockRepository() {
  return {
    loadRaw: jest.fn(),
    saveRaw: jest.fn(),
  } as unknown as jest.Mocked<DataRepository>;
}

function encodeJson(data: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(data));
}

describe('validateDefinitions', () => {
  it('should accept valid definitions', () => {
    expect(validateDefinitions(validDefinitions)).toEqual(validDefinitions);
  });

  it('should throw ValidationError for invalid data', () => {
    expect(() => validateDefinitions(null)).toThrow(ValidationError);
    expect(() => validateDefinitions([{ invalid: true }])).toThrow(
      ValidationError,
    );
  });

  it('should require weaponId in weaponProjectiles', () => {
    const defWithoutWeaponId = {
      ...validDefinition,
      weaponProjectiles: [{ id: 500, startCycleOffset: 30 }],
    };
    expect(() => validateDefinitions([defWithoutWeaponId])).toThrow(
      ValidationError,
    );
  });

  it('should allow optional weaponId in projectile', () => {
    const defWithProjectile = {
      ...validDefinition,
      projectile: { id: 500, startCycleOffset: 30 },
    };
    expect(validateDefinitions([defWithProjectile])).toEqual([
      defWithProjectile,
    ]);
  });
});

describe('AttackRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('initialize', () => {
    it('should load definitions from repository when available', async () => {
      const mockRepo = createMockRepository();
      mockRepo.loadRaw.mockResolvedValue(encodeJson(validDefinitions));

      const repo = new AttackRepository(mockRepo, '/fallback.json');
      await repo.initialize();

      expect(mockRepo.loadRaw).toHaveBeenCalledWith(
        expect.stringContaining('attack-definitions'),
      );
      expect(repo.getDefinitionsJson()).toEqual(validDefinitions);
      expect(mockedReadFile).not.toHaveBeenCalled();
    });

    it('should fall back to local file when repository returns NotFound', async () => {
      const mockRepo = createMockRepository();
      mockRepo.loadRaw.mockRejectedValue(new DataRepository.NotFound(''));

      mockedReadFile.mockResolvedValue(JSON.stringify(validDefinitions));

      const repo = new AttackRepository(mockRepo, '/fallback.json');
      await repo.initialize();

      expect(mockedReadFile).toHaveBeenCalledWith('/fallback.json', 'utf8');
      expect(repo.getDefinitionsJson()).toEqual(validDefinitions);
    });

    it('should fall back to local file when repository load fails', async () => {
      const mockRepo = createMockRepository();
      mockRepo.loadRaw.mockRejectedValue(new Error('Network error'));

      mockedReadFile.mockResolvedValue(JSON.stringify(validDefinitions));

      const repo = new AttackRepository(mockRepo, '/fallback.json');
      await repo.initialize();

      expect(mockedReadFile).toHaveBeenCalledWith('/fallback.json', 'utf8');
      expect(repo.getDefinitionsJson()).toEqual(validDefinitions);
    });

    it('should use local file when no repository configured', async () => {
      mockedReadFile.mockResolvedValue(JSON.stringify(validDefinitions));

      const repo = new AttackRepository(null, '/fallback.json');
      await repo.initialize();

      expect(mockedReadFile).toHaveBeenCalledWith('/fallback.json', 'utf8');
      expect(repo.getDefinitionsJson()).toEqual(validDefinitions);
    });

    it('should throw when both repository and local file fail', async () => {
      const mockRepo = createMockRepository();
      mockRepo.loadRaw.mockRejectedValue(new DataRepository.NotFound(''));
      mockedReadFile.mockRejectedValue(new Error('File not found'));

      const repo = new AttackRepository(mockRepo, '/fallback.json');

      await expect(repo.initialize()).rejects.toThrow(
        'Failed to load attack definitions from /fallback.json',
      );
    });

    it('should fall back to local file when repository data is invalid', async () => {
      const mockRepo = createMockRepository();
      mockRepo.loadRaw.mockResolvedValue(encodeJson([{ invalid: true }]));
      mockedReadFile.mockResolvedValue(JSON.stringify(validDefinitions));

      const repo = new AttackRepository(mockRepo, '/fallback.json');
      await repo.initialize();

      expect(mockedReadFile).toHaveBeenCalledWith('/fallback.json', 'utf8');
      expect(repo.getDefinitionsJson()).toEqual(validDefinitions);
    });

    it('should throw when repository data is invalid and local file fails', async () => {
      const mockRepo = createMockRepository();
      mockRepo.loadRaw.mockResolvedValue(encodeJson([{ invalid: true }]));
      mockedReadFile.mockRejectedValue(new Error('File not found'));

      const repo = new AttackRepository(mockRepo, '/fallback.json');

      await expect(repo.initialize()).rejects.toThrow();
    });

    it('should throw ValidationError when local file data is invalid', async () => {
      mockedReadFile.mockResolvedValue(JSON.stringify([{ invalid: true }]));

      const repo = new AttackRepository(null, '/fallback.json');

      await expect(repo.initialize()).rejects.toThrow();
    });
  });

  describe('reload', () => {
    it('should update definitions when reloaded', async () => {
      const mockRepo = createMockRepository();
      mockRepo.loadRaw.mockResolvedValue(encodeJson([validDefinition]));

      const repo = new AttackRepository(mockRepo, '/fallback.json');
      await repo.initialize();

      expect(repo.getDefinitionsJson()).toHaveLength(1);

      mockRepo.loadRaw.mockResolvedValue(encodeJson(validDefinitions));
      await repo.reload();

      expect(repo.getDefinitionsJson()).toHaveLength(2);
    });
  });

  describe('getDefinitions', () => {
    it('should return protobuf definitions', async () => {
      mockedReadFile.mockResolvedValue(JSON.stringify(validDefinitions));

      const repo = new AttackRepository(null, '/fallback.json');
      await repo.initialize();

      const definitions = repo.getDefinitions();
      expect(definitions).toHaveLength(2);
      expect(definitions[0].getId()).toBe(1);
      expect(definitions[0].getName()).toBe('Test Attack');
      expect(definitions[1].getId()).toBe(2);
      expect(definitions[1].hasProjectile()).toBe(true);
    });
  });

  describe('createDefinitionsMessage', () => {
    it('should create a ServerMessage with definitions', async () => {
      mockedReadFile.mockResolvedValue(JSON.stringify(validDefinitions));

      const repo = new AttackRepository(null, '/fallback.json');
      await repo.initialize();

      const message = repo.createDefinitionsMessage();

      expect(message.getType()).toBe(ServerMessage.Type.ATTACK_DEFINITIONS);
      expect(message.getAttackDefinitionsList()).toHaveLength(2);
    });
  });

  describe('uploadDefinitions', () => {
    it('should throw when no repository configured', async () => {
      mockedReadFile.mockResolvedValue(JSON.stringify(validDefinitions));

      const repo = new AttackRepository(null, '/fallback.json');
      await repo.initialize();

      await expect(repo.uploadDefinitions(validDefinitions)).rejects.toThrow(
        'No repository configured for upload',
      );
    });

    it('should validate definitions before uploading', async () => {
      const mockRepo = createMockRepository();
      mockRepo.loadRaw.mockResolvedValue(encodeJson(validDefinitions));

      const repo = new AttackRepository(mockRepo, '/fallback.json');
      await repo.initialize();

      await expect(repo.uploadDefinitions([{ invalid: true }])).rejects.toThrow(
        ValidationError,
      );

      expect(mockRepo.saveRaw).not.toHaveBeenCalled();
    });

    it('should save backup and current version', async () => {
      const mockRepo = createMockRepository();
      mockRepo.loadRaw.mockResolvedValue(encodeJson([validDefinition]));
      mockRepo.saveRaw.mockResolvedValue(undefined);

      const repo = new AttackRepository(mockRepo, '/fallback.json');
      await repo.initialize();

      const newDefinitions = [...validDefinitions];
      await repo.uploadDefinitions(newDefinitions);

      expect(mockRepo.saveRaw).toHaveBeenCalledTimes(2);

      const calls = mockRepo.saveRaw.mock.calls;
      expect(calls[0][0]).toMatch(/^attack-definitions\/v.*\.json$/);
      expect(calls[1][0]).toBe('attack-definitions/current.json');
    });

    it('should update in-memory definitions after upload', async () => {
      const mockRepo = createMockRepository();
      mockRepo.loadRaw.mockResolvedValue(encodeJson([validDefinition]));
      mockRepo.saveRaw.mockResolvedValue(undefined);

      const repo = new AttackRepository(mockRepo, '/fallback.json');
      await repo.initialize();

      expect(repo.getDefinitionsJson()).toHaveLength(1);

      await repo.uploadDefinitions(validDefinitions);

      expect(repo.getDefinitionsJson()).toHaveLength(2);
      expect(repo.getDefinitionsJson()).toEqual(validDefinitions);
    });
  });
});
