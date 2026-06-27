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
import { RedisClientType } from 'redis';
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

export type DefinitionType = 'attacks' | 'spells';

/**
 * Pubsub channel socket-server instances use to coordinate definition reloads
 * across the fleet. After one instance accepts an upload, it broadcasts a
 * fire-and-forget update message so the others reload the affected set from
 * the data repository and push it to their own connected clients.
 */
export const DEFINITIONS_RELOAD_PUBSUB_KEY = 'definitions-reload';

export type DefinitionsReloadUpdate = {
  type: DefinitionType;
};

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
  /**
   * Optional Redis client used to notify other instances when definitions are
   * uploaded. When omitted, uploads are not propagated across the fleet.
   */
  redis?: RedisClientType;
}

export class ActionDefinitionsRepository {
  private attackDefinitions: AttackDefinition[] = [];
  private attackJsonDefinitions: AttackDefinitionJson[] = [];
  private spellDefinitions: SpellDefinition[] = [];
  private spellJsonDefinitions: SpellDefinitionJson[] = [];

  private repository: DataRepository | null;
  private fallbackPaths: Record<DefinitionType, string>;
  private redis: RedisClientType | null;

  constructor(config: ActionDefinitionsConfig) {
    this.repository = config.repository;
    this.fallbackPaths = {
      attacks: config.attackFallbackPath,
      spells: config.spellFallbackPath,
    };
    this.redis = config.redis ?? null;
  }

  /**
   * Initializes the repository by loading all definitions from the
   * configured data repository or local fallback files.
   */
  public async initialize(): Promise<void> {
    await this.refreshAttacks(true);
    await this.refreshSpells(true);
  }

  /**
   * Reloads attack definitions from the data repository without falling back
   * to a bundled file.
   */
  public async reloadAttacks(): Promise<void> {
    await this.refreshAttacks(false);
  }

  private async refreshAttacks(allowFallback: boolean): Promise<void> {
    const definitions = await this.loadDefinitions(
      'attacks',
      validateAttackDefinitions,
      allowFallback,
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
  public async uploadAttackDefinitions(
    definitions: unknown,
  ): Promise<AttackDefinitionJson[]> {
    const validated = await this.uploadDefinitions(
      'attacks',
      definitions,
      validateAttackDefinitions,
    );
    this.attackDefinitions = validated.map(attackDefinitionJsonToProto);
    this.attackJsonDefinitions = validated;
    return validated;
  }

  /**
   * Reloads spell definitions from the data repository without falling back
   * to a bundled file.
   */
  public async reloadSpells(): Promise<void> {
    await this.refreshSpells(false);
  }

  private async refreshSpells(allowFallback: boolean): Promise<void> {
    const definitions = await this.loadDefinitions(
      'spells',
      validateSpellDefinitions,
      allowFallback,
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
  public async uploadSpellDefinitions(
    definitions: unknown,
  ): Promise<SpellDefinitionJson[]> {
    const validated = await this.uploadDefinitions(
      'spells',
      definitions,
      validateSpellDefinitions,
    );
    this.spellDefinitions = validated.map(spellDefinitionJsonToProto);
    this.spellJsonDefinitions = validated;
    return validated;
  }

  /**
   * Loads definitions from the repository. If `allowFallback` is set, falls
   * back to reading from the local file if the repository is unavailable or
   * unconfigured. Otherwise, keeps its last known definitions on failure.
   */
  private async loadDefinitions<T>(
    type: DefinitionType,
    validate: (data: unknown) => T[],
    allowFallback: boolean,
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
        if (!allowFallback) {
          throw e;
        }
      }
    } else if (!allowFallback) {
      throw new Error(`No repository configured to reload ${type} definitions`);
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

    await this.publishReload(type);

    return validated;
  }

  /** Publishes a definitions update notification for the specified type. */
  private async publishReload(type: DefinitionType): Promise<void> {
    if (this.redis === null) {
      return;
    }

    const update: DefinitionsReloadUpdate = { type };
    try {
      await this.redis.publish(
        DEFINITIONS_RELOAD_PUBSUB_KEY,
        JSON.stringify(update),
      );
    } catch (e) {
      logger.error('definitions_reload_publish_failed', {
        key: DEFINITIONS_RELOAD_PUBSUB_KEY,
        type,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
}
