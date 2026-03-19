import {
  attackDefinitionJsonToProto,
  attackDefinitionSchema,
  DataRepository,
  spellDefinitionJsonToProto,
  spellDefinitionSchema,
} from '@blert/common';
import {
  AttackDefinition,
  ServerMessage,
  SpellDefinition,
} from '@blert/common/generated/server_message_pb';
import { readFile } from 'fs/promises';
import { z } from 'zod';

import logger from './log';

const attackDefinitionsSchema = z
  .array(attackDefinitionSchema)
  .min(1, 'At least one attack definition is required');

export type AttackDefinitionJson = z.infer<typeof attackDefinitionSchema>;

const spellDefinitionsSchema = z
  .array(spellDefinitionSchema)
  .min(1, 'At least one spell definition is required');

export type SpellDefinitionJson = z.infer<typeof spellDefinitionSchema>;

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }

  static fromIssue(issue: z.ZodIssue): ValidationError {
    const path = issue.path.length > 0 ? issue.path.join('.') : '';
    const message = path ? `${path}: ${issue.message}` : issue.message;
    return new ValidationError(message);
  }
}

export function validateAttackDefinitions(
  data: unknown,
): AttackDefinitionJson[] {
  const result = attackDefinitionsSchema.safeParse(data);
  if (!result.success) {
    throw ValidationError.fromIssue(result.error.issues[0]);
  }
  return result.data;
}

export function validateSpellDefinitions(data: unknown): SpellDefinitionJson[] {
  const result = spellDefinitionsSchema.safeParse(data);
  if (!result.success) {
    throw ValidationError.fromIssue(result.error.issues[0]);
  }
  return result.data;
}

type DefinitionType = 'attacks' | 'spells';

type DefinitionConfig = {
  repositoryPath: string;
  timestampedPath: (date: Date) => string;
};

const DEFINITION_CONFIGS: Record<DefinitionType, DefinitionConfig> = {
  attacks: {
    repositoryPath: 'attack-definitions/current.json',
    timestampedPath: (date: Date) =>
      `attack-definitions/v${date.toISOString().replace(/[:.]/g, '-')}.json`,
  },
  spells: {
    repositoryPath: 'spell-definitions/current.json',
    timestampedPath: (date: Date) =>
      `spell-definitions/v${date.toISOString().replace(/[:.]/g, '-')}.json`,
  },
};

export interface ActionDefinitionsConfig {
  /** Optional DataRepository for storing/loading definitions. */
  repository: DataRepository | null;
  /** Path to a local JSON file for attack definitions fallback. */
  attackFallbackPath: string;
  /** Path to a local JSON file for spell definitions fallback. */
  spellFallbackPath: string;
}

export class ActionDefinitionsRepository {
  private attackDefinitions: AttackDefinition[] = [];
  private attackJsonDefinitions: AttackDefinitionJson[] = [];
  private spellDefinitions: SpellDefinition[] = [];
  private spellJsonDefinitions: SpellDefinitionJson[] = [];

  private repository: DataRepository | null;
  private fallbackPaths: Record<DefinitionType, string>;

  constructor(config: ActionDefinitionsConfig) {
    this.repository = config.repository;
    this.fallbackPaths = {
      attacks: config.attackFallbackPath,
      spells: config.spellFallbackPath,
    };
  }

  /**
   * Initializes the repository by loading all definitions from the
   * configured data repository or local fallback files.
   */
  public async initialize(): Promise<void> {
    await this.reloadAttacks();
    await this.reloadSpells();
  }

  /**
   * Reloads attack definitions from the repository, falling back to the local
   * file if the repository is unavailable or not configured.
   */
  public async reloadAttacks(): Promise<void> {
    const definitions = await this.loadDefinitions(
      'attacks',
      validateAttackDefinitions,
    );
    this.attackDefinitions = definitions.map(attackDefinitionJsonToProto);
    this.attackJsonDefinitions = definitions;
  }

  /** Returns the current attack definitions as protobuf objects. */
  public getAttackDefinitions(): AttackDefinition[] {
    return this.attackDefinitions;
  }

  /** Returns the current attack definitions as JSON objects. */
  public getAttackDefinitionsJson(): AttackDefinitionJson[] {
    return this.attackJsonDefinitions;
  }

  /** Creates a ServerMessage containing all current attack definitions. */
  public createAttackDefinitionsMessage(): ServerMessage {
    const message = new ServerMessage();
    message.setType(ServerMessage.Type.ATTACK_DEFINITIONS);
    message.setAttackDefinitionsList(this.attackDefinitions);
    return message;
  }

  /**
   * Uploads new attack definitions to the repository, saving both a current
   * version and a timestamped backup.
   *
   * @param definitions The new definitions to upload.
   * @throws ValidationError if the definitions are invalid.
   * @throws Error if no repository is configured.
   */
  public async uploadAttackDefinitions(definitions: unknown): Promise<void> {
    const validated = await this.uploadDefinitions(
      'attacks',
      definitions,
      validateAttackDefinitions,
    );
    this.attackDefinitions = validated.map(attackDefinitionJsonToProto);
    this.attackJsonDefinitions = validated;
  }

  /**
   * Reloads spell definitions from the repository, falling back to the local
   * file if the repository is unavailable or not configured.
   */
  public async reloadSpells(): Promise<void> {
    const definitions = await this.loadDefinitions(
      'spells',
      validateSpellDefinitions,
    );
    this.spellDefinitions = definitions.map(spellDefinitionJsonToProto);
    this.spellJsonDefinitions = definitions;
  }

  /** Returns the current spell definitions as protobuf objects. */
  public getSpellDefinitions(): SpellDefinition[] {
    return this.spellDefinitions;
  }

  /** Returns the current spell definitions as JSON objects. */
  public getSpellDefinitionsJson(): SpellDefinitionJson[] {
    return this.spellJsonDefinitions;
  }

  /** Creates a ServerMessage containing all current spell definitions. */
  public createSpellDefinitionsMessage(): ServerMessage {
    const message = new ServerMessage();
    message.setType(ServerMessage.Type.SPELL_DEFINITIONS);
    message.setSpellDefinitionsList(this.spellDefinitions);
    return message;
  }

  /**
   * Uploads new spell definitions to the repository, saving both a current
   * version and a timestamped backup.
   *
   * @param definitions The new definitions to upload.
   * @throws ValidationError if the definitions are invalid.
   * @throws Error if no repository is configured.
   */
  public async uploadSpellDefinitions(definitions: unknown): Promise<void> {
    const validated = await this.uploadDefinitions(
      'spells',
      definitions,
      validateSpellDefinitions,
    );
    this.spellDefinitions = validated.map(spellDefinitionJsonToProto);
    this.spellJsonDefinitions = validated;
  }

  /**
   * Loads definitions from the repository, falling back to the local file if
   * the repository is unavailable or not configured.
   */
  private async loadDefinitions<T>(
    type: DefinitionType,
    validate: (data: unknown) => T[],
  ): Promise<T[]> {
    const config = DEFINITION_CONFIGS[type];
    const fallbackPath = this.fallbackPaths[type];

    if (this.repository !== null) {
      try {
        const data = await this.repository.loadRaw(config.repositoryPath);
        const parsed: unknown = JSON.parse(new TextDecoder().decode(data));
        const definitions = validate(parsed);
        logger.info('definitions_loaded', {
          type,
          source: 'repository',
          count: definitions.length,
        });
        return definitions;
      } catch (e) {
        if (!(e instanceof DataRepository.NotFound)) {
          logger.warn('definitions_load_failed', {
            type,
            source: 'repository',
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    }

    try {
      const data = await readFile(fallbackPath, 'utf8');
      const parsed: unknown = JSON.parse(data);
      const definitions = validate(parsed);
      logger.info('definitions_loaded', {
        type,
        source: 'local_fallback',
        path: fallbackPath,
        count: definitions.length,
      });
      return definitions;
    } catch (e) {
      logger.error('definitions_load_failed', {
        type,
        source: 'local_fallback',
        path: fallbackPath,
        error: e instanceof Error ? e.message : String(e),
      });
      const typeLabel = type === 'attacks' ? 'attack' : 'spell';
      throw new Error(
        `Failed to load ${typeLabel} definitions from ${fallbackPath}`,
      );
    }
  }

  /**
   * Uploads definitions to the repository, saving both a current version and
   * a timestamped backup.
   */
  private async uploadDefinitions<T>(
    type: DefinitionType,
    definitions: unknown,
    validate: (data: unknown) => T[],
  ): Promise<T[]> {
    if (this.repository === null) {
      throw new Error('No repository configured for upload');
    }

    const validated = validate(definitions);

    const jsonData = JSON.stringify(validated, null, 2);
    const data = new TextEncoder().encode(jsonData);
    const config = DEFINITION_CONFIGS[type];

    const backupPath = config.timestampedPath(new Date());
    await this.repository.saveRaw(backupPath, data);
    await this.repository.saveRaw(config.repositoryPath, data);

    logger.info('definitions_uploaded', {
      type,
      backupPath,
      count: validated.length,
    });

    return validated;
  }
}
