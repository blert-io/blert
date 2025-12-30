/* eslint-disable @typescript-eslint/unbound-method */
/* eslint-disable @typescript-eslint/no-base-to-string */
import { DataRepository } from '@blert/common';
import { ServerMessage } from '@blert/common/generated/server_message_pb';

jest.mock('fs/promises');

import { readFile } from 'fs/promises';
import {
  ActionDefinitionsRepository,
  AttackDefinitionJson,
  SpellDefinitionJson,
  ValidationError,
  validateAttackDefinitions,
  validateSpellDefinitions,
} from '../action-definitions';

const mockedReadFile = jest.mocked(readFile);

const validAttackDefinition: AttackDefinitionJson = {
  protoId: 1,
  name: 'Test Attack',
  weaponIds: [1234],
  animationIds: [100],
  cooldown: 4,
  category: 'MELEE',
};

const validAttackDefinitions: AttackDefinitionJson[] = [
  validAttackDefinition,
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

const validSpellDefinition: SpellDefinitionJson = {
  id: 1,
  name: 'Test Spell',
  animationIds: [100],
  graphics: [{ id: 200, durationTicks: 5, maxFrame: 10 }],
  stallTicks: 2,
};

const validSpellDefinitions: SpellDefinitionJson[] = [
  validSpellDefinition,
  {
    id: 2,
    name: 'Target Spell',
    animationIds: [300],
    targetGraphics: [{ id: 400, durationTicks: 3, maxFrame: 8 }],
    stallTicks: 0,
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

describe('validateAttackDefinitions', () => {
  it('should accept valid definitions', () => {
    expect(validateAttackDefinitions(validAttackDefinitions)).toEqual(
      validAttackDefinitions,
    );
  });

  it('should throw ValidationError for invalid data', () => {
    expect(() => validateAttackDefinitions(null)).toThrow(ValidationError);
    expect(() => validateAttackDefinitions([{ invalid: true }])).toThrow(
      ValidationError,
    );
  });

  it('should require weaponId in weaponProjectiles', () => {
    const defWithoutWeaponId = {
      ...validAttackDefinition,
      weaponProjectiles: [{ id: 500, startCycleOffset: 30 }],
    };
    expect(() => validateAttackDefinitions([defWithoutWeaponId])).toThrow(
      ValidationError,
    );
  });

  it('should allow optional weaponId in projectile', () => {
    const defWithProjectile = {
      ...validAttackDefinition,
      projectile: { id: 500, startCycleOffset: 30 },
    };
    expect(validateAttackDefinitions([defWithProjectile])).toEqual([
      defWithProjectile,
    ]);
  });
});

describe('validateSpellDefinitions', () => {
  it('should accept valid definitions', () => {
    expect(validateSpellDefinitions(validSpellDefinitions)).toEqual(
      validSpellDefinitions,
    );
  });

  it('should throw ValidationError for invalid data', () => {
    expect(() => validateSpellDefinitions(null)).toThrow(ValidationError);
    expect(() => validateSpellDefinitions([{ invalid: true }])).toThrow(
      ValidationError,
    );
  });

  it('should accept spells without graphics', () => {
    const spellWithoutGraphics = {
      id: 3,
      name: 'No Graphics Spell',
      animationIds: [500],
      stallTicks: 1,
    };
    expect(validateSpellDefinitions([spellWithoutGraphics])).toEqual([
      spellWithoutGraphics,
    ]);
  });

  it('should accept spells with empty animationIds', () => {
    const spellWithEmptyAnims = {
      ...validSpellDefinition,
      animationIds: [],
    };
    expect(validateSpellDefinitions([spellWithEmptyAnims])).toEqual([
      spellWithEmptyAnims,
    ]);
  });
});

describe('ActionDefinitionsRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('initialize', () => {
    it('should load definitions from repository when available', async () => {
      const mockRepo = createMockRepository();
      mockRepo.loadRaw.mockImplementation((path: string) => {
        if (path.includes('attack')) {
          return Promise.resolve(encodeJson(validAttackDefinitions));
        }
        return Promise.resolve(encodeJson(validSpellDefinitions));
      });

      const repo = new ActionDefinitionsRepository({
        repository: mockRepo,
        attackFallbackPath: '/attacks.json',
        spellFallbackPath: '/spells.json',
      });
      await repo.initialize();

      expect(mockRepo.loadRaw).toHaveBeenCalledWith(
        expect.stringContaining('attack-definitions'),
      );
      expect(mockRepo.loadRaw).toHaveBeenCalledWith(
        expect.stringContaining('spell-definitions'),
      );
      expect(repo.getAttackDefinitionsJson()).toEqual(validAttackDefinitions);
      expect(repo.getSpellDefinitionsJson()).toEqual(validSpellDefinitions);
      expect(mockedReadFile).not.toHaveBeenCalled();
    });

    it('should fall back to local file when repository returns NotFound', async () => {
      const mockRepo = createMockRepository();
      mockRepo.loadRaw.mockRejectedValue(new DataRepository.NotFound(''));

      mockedReadFile.mockImplementation((path) => {
        if (String(path).includes('attacks')) {
          return Promise.resolve(JSON.stringify(validAttackDefinitions));
        }
        return Promise.resolve(JSON.stringify(validSpellDefinitions));
      });

      const repo = new ActionDefinitionsRepository({
        repository: mockRepo,
        attackFallbackPath: '/attacks.json',
        spellFallbackPath: '/spells.json',
      });
      await repo.initialize();

      expect(mockedReadFile).toHaveBeenCalledWith('/attacks.json', 'utf8');
      expect(mockedReadFile).toHaveBeenCalledWith('/spells.json', 'utf8');
      expect(repo.getAttackDefinitionsJson()).toEqual(validAttackDefinitions);
      expect(repo.getSpellDefinitionsJson()).toEqual(validSpellDefinitions);
    });

    it('should use local file when no repository configured', async () => {
      mockedReadFile.mockImplementation((path) => {
        if (String(path).includes('attacks')) {
          return Promise.resolve(JSON.stringify(validAttackDefinitions));
        }
        return Promise.resolve(JSON.stringify(validSpellDefinitions));
      });

      const repo = new ActionDefinitionsRepository({
        repository: null,
        attackFallbackPath: '/attacks.json',
        spellFallbackPath: '/spells.json',
      });
      await repo.initialize();

      expect(mockedReadFile).toHaveBeenCalledWith('/attacks.json', 'utf8');
      expect(mockedReadFile).toHaveBeenCalledWith('/spells.json', 'utf8');
      expect(repo.getAttackDefinitionsJson()).toEqual(validAttackDefinitions);
      expect(repo.getSpellDefinitionsJson()).toEqual(validSpellDefinitions);
    });

    it('should throw when attack fallback file fails', async () => {
      const mockRepo = createMockRepository();
      mockRepo.loadRaw.mockRejectedValue(new DataRepository.NotFound(''));
      mockedReadFile.mockRejectedValue(new Error('File not found'));

      const repo = new ActionDefinitionsRepository({
        repository: mockRepo,
        attackFallbackPath: '/attacks.json',
        spellFallbackPath: '/spells.json',
      });

      await expect(repo.initialize()).rejects.toThrow(
        'Failed to load attack definitions from /attacks.json',
      );
    });
  });

  describe('reloadAttacks', () => {
    it('should update attack definitions when reloaded', async () => {
      const mockRepo = createMockRepository();
      mockRepo.loadRaw.mockImplementation((path: string) => {
        if (path.includes('attack')) {
          return Promise.resolve(encodeJson([validAttackDefinition]));
        }
        return Promise.resolve(encodeJson(validSpellDefinitions));
      });

      const repo = new ActionDefinitionsRepository({
        repository: mockRepo,
        attackFallbackPath: '/attacks.json',
        spellFallbackPath: '/spells.json',
      });
      await repo.initialize();

      expect(repo.getAttackDefinitionsJson()).toHaveLength(1);

      mockRepo.loadRaw.mockImplementation((path: string) => {
        if (path.includes('attack')) {
          return Promise.resolve(encodeJson(validAttackDefinitions));
        }
        return Promise.resolve(encodeJson(validSpellDefinitions));
      });
      await repo.reloadAttacks();

      expect(repo.getAttackDefinitionsJson()).toHaveLength(2);
    });
  });

  describe('getAttackDefinitions', () => {
    it('should return protobuf definitions', async () => {
      mockedReadFile.mockImplementation((path) => {
        if (String(path).includes('attacks')) {
          return Promise.resolve(JSON.stringify(validAttackDefinitions));
        }
        return Promise.resolve(JSON.stringify(validSpellDefinitions));
      });

      const repo = new ActionDefinitionsRepository({
        repository: null,
        attackFallbackPath: '/attacks.json',
        spellFallbackPath: '/spells.json',
      });
      await repo.initialize();

      const definitions = repo.getAttackDefinitions();
      expect(definitions).toHaveLength(2);
      expect(definitions[0].getId()).toBe(1);
      expect(definitions[0].getName()).toBe('Test Attack');
      expect(definitions[1].getId()).toBe(2);
      expect(definitions[1].hasProjectile()).toBe(true);
    });
  });

  describe('getSpellDefinitions', () => {
    it('should return protobuf definitions', async () => {
      mockedReadFile.mockImplementation((path) => {
        if (String(path).includes('attacks')) {
          return Promise.resolve(JSON.stringify(validAttackDefinitions));
        }
        return Promise.resolve(JSON.stringify(validSpellDefinitions));
      });

      const repo = new ActionDefinitionsRepository({
        repository: null,
        attackFallbackPath: '/attacks.json',
        spellFallbackPath: '/spells.json',
      });
      await repo.initialize();

      const definitions = repo.getSpellDefinitions();
      expect(definitions).toHaveLength(2);
      expect(definitions[0].getId()).toBe(1);
      expect(definitions[0].getName()).toBe('Test Spell');
      expect(definitions[1].getId()).toBe(2);
    });
  });

  describe('createAttackDefinitionsMessage', () => {
    it('should create a ServerMessage with definitions', async () => {
      mockedReadFile.mockImplementation((path) => {
        if (String(path).includes('attacks')) {
          return Promise.resolve(JSON.stringify(validAttackDefinitions));
        }
        return Promise.resolve(JSON.stringify(validSpellDefinitions));
      });

      const repo = new ActionDefinitionsRepository({
        repository: null,
        attackFallbackPath: '/attacks.json',
        spellFallbackPath: '/spells.json',
      });
      await repo.initialize();

      const message = repo.createAttackDefinitionsMessage();

      expect(message.getType()).toBe(ServerMessage.Type.ATTACK_DEFINITIONS);
      expect(message.getAttackDefinitionsList()).toHaveLength(2);
    });
  });

  describe('createSpellDefinitionsMessage', () => {
    it('should create a ServerMessage with definitions', async () => {
      mockedReadFile.mockImplementation((path) => {
        if (String(path).includes('attacks')) {
          return Promise.resolve(JSON.stringify(validAttackDefinitions));
        }
        return Promise.resolve(JSON.stringify(validSpellDefinitions));
      });

      const repo = new ActionDefinitionsRepository({
        repository: null,
        attackFallbackPath: '/attacks.json',
        spellFallbackPath: '/spells.json',
      });
      await repo.initialize();

      const message = repo.createSpellDefinitionsMessage();

      expect(message.getType()).toBe(ServerMessage.Type.SPELL_DEFINITIONS);
      expect(message.getSpellDefinitionsList()).toHaveLength(2);
    });
  });

  describe('uploadAttackDefinitions', () => {
    it('should throw when no repository configured', async () => {
      mockedReadFile.mockImplementation((path) => {
        if (String(path).includes('attacks')) {
          return Promise.resolve(JSON.stringify(validAttackDefinitions));
        }
        return Promise.resolve(JSON.stringify(validSpellDefinitions));
      });

      const repo = new ActionDefinitionsRepository({
        repository: null,
        attackFallbackPath: '/attacks.json',
        spellFallbackPath: '/spells.json',
      });
      await repo.initialize();

      await expect(
        repo.uploadAttackDefinitions(validAttackDefinitions),
      ).rejects.toThrow('No repository configured for upload');
    });

    it('should validate definitions before uploading', async () => {
      const mockRepo = createMockRepository();
      mockRepo.loadRaw.mockImplementation((path: string) => {
        if (path.includes('attack')) {
          return Promise.resolve(encodeJson(validAttackDefinitions));
        }
        return Promise.resolve(encodeJson(validSpellDefinitions));
      });

      const repo = new ActionDefinitionsRepository({
        repository: mockRepo,
        attackFallbackPath: '/attacks.json',
        spellFallbackPath: '/spells.json',
      });
      await repo.initialize();

      await expect(
        repo.uploadAttackDefinitions([{ invalid: true }]),
      ).rejects.toThrow(ValidationError);

      expect(mockRepo.saveRaw).not.toHaveBeenCalled();
    });

    it('should save backup and current version', async () => {
      const mockRepo = createMockRepository();
      mockRepo.loadRaw.mockImplementation((path: string) => {
        if (path.includes('attack')) {
          return Promise.resolve(encodeJson([validAttackDefinition]));
        }
        return Promise.resolve(encodeJson(validSpellDefinitions));
      });
      mockRepo.saveRaw.mockResolvedValue(undefined);

      const repo = new ActionDefinitionsRepository({
        repository: mockRepo,
        attackFallbackPath: '/attacks.json',
        spellFallbackPath: '/spells.json',
      });
      await repo.initialize();

      const newDefinitions = [...validAttackDefinitions];
      await repo.uploadAttackDefinitions(newDefinitions);

      expect(mockRepo.saveRaw).toHaveBeenCalledTimes(2);

      const calls = mockRepo.saveRaw.mock.calls;
      expect(calls[0][0]).toMatch(/^attack-definitions\/v.*\.json$/);
      expect(calls[1][0]).toBe('attack-definitions/current.json');
    });

    it('should update in-memory definitions after upload', async () => {
      const mockRepo = createMockRepository();
      mockRepo.loadRaw.mockImplementation((path: string) => {
        if (path.includes('attack')) {
          return Promise.resolve(encodeJson([validAttackDefinition]));
        }
        return Promise.resolve(encodeJson(validSpellDefinitions));
      });
      mockRepo.saveRaw.mockResolvedValue(undefined);

      const repo = new ActionDefinitionsRepository({
        repository: mockRepo,
        attackFallbackPath: '/attacks.json',
        spellFallbackPath: '/spells.json',
      });
      await repo.initialize();

      expect(repo.getAttackDefinitionsJson()).toHaveLength(1);

      await repo.uploadAttackDefinitions(validAttackDefinitions);

      expect(repo.getAttackDefinitionsJson()).toHaveLength(2);
      expect(repo.getAttackDefinitionsJson()).toEqual(validAttackDefinitions);
    });
  });

  describe('uploadSpellDefinitions', () => {
    it('should throw when no repository configured', async () => {
      mockedReadFile.mockImplementation((path) => {
        if (String(path).includes('attacks')) {
          return Promise.resolve(JSON.stringify(validAttackDefinitions));
        }
        return Promise.resolve(JSON.stringify(validSpellDefinitions));
      });

      const repo = new ActionDefinitionsRepository({
        repository: null,
        attackFallbackPath: '/attacks.json',
        spellFallbackPath: '/spells.json',
      });
      await repo.initialize();

      await expect(
        repo.uploadSpellDefinitions(validSpellDefinitions),
      ).rejects.toThrow('No repository configured for upload');
    });

    it('should save backup and current version', async () => {
      const mockRepo = createMockRepository();
      mockRepo.loadRaw.mockImplementation((path: string) => {
        if (path.includes('attack')) {
          return Promise.resolve(encodeJson(validAttackDefinitions));
        }
        return Promise.resolve(encodeJson([validSpellDefinition]));
      });
      mockRepo.saveRaw.mockResolvedValue(undefined);

      const repo = new ActionDefinitionsRepository({
        repository: mockRepo,
        attackFallbackPath: '/attacks.json',
        spellFallbackPath: '/spells.json',
      });
      await repo.initialize();

      await repo.uploadSpellDefinitions(validSpellDefinitions);

      expect(mockRepo.saveRaw).toHaveBeenCalledTimes(2);

      const calls = mockRepo.saveRaw.mock.calls;
      expect(calls[0][0]).toMatch(/^spell-definitions\/v.*\.json$/);
      expect(calls[1][0]).toBe('spell-definitions/current.json');
    });

    it('should update in-memory definitions after upload', async () => {
      const mockRepo = createMockRepository();
      mockRepo.loadRaw.mockImplementation((path: string) => {
        if (path.includes('attack')) {
          return Promise.resolve(encodeJson(validAttackDefinitions));
        }
        return Promise.resolve(encodeJson([validSpellDefinition]));
      });
      mockRepo.saveRaw.mockResolvedValue(undefined);

      const repo = new ActionDefinitionsRepository({
        repository: mockRepo,
        attackFallbackPath: '/attacks.json',
        spellFallbackPath: '/spells.json',
      });
      await repo.initialize();

      expect(repo.getSpellDefinitionsJson()).toHaveLength(1);

      await repo.uploadSpellDefinitions(validSpellDefinitions);

      expect(repo.getSpellDefinitionsJson()).toHaveLength(2);
      expect(repo.getSpellDefinitionsJson()).toEqual(validSpellDefinitions);
    });
  });
});
