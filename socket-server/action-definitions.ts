import { DataRepository } from '@blert/common';
import {
  PlayerAttackMap,
  PlayerSpellMap,
} from '@blert/common/generated/event_pb';
import {
  AttackDefinition,
  ServerMessage,
  SpellDefinition,
} from '@blert/common/generated/server_message_pb';
import { readFile } from 'fs/promises';
import { z } from 'zod';

import logger from './log';

type PlayerAttackValue = PlayerAttackMap[keyof PlayerAttackMap];
type PlayerSpellValue = PlayerSpellMap[keyof PlayerSpellMap];

// Attack definition schemas.

const projectileSchema = z.object({
  id: z.number().int().nonnegative(),
  startCycleOffset: z.number().int().nonnegative(),
  weaponId: z.number().int().positive().optional(),
});

const weaponProjectileSchema = z.object({
  id: z.number().int().nonnegative(),
  startCycleOffset: z.number().int().nonnegative(),
  weaponId: z.number().int().positive(),
});

const categorySchema = z.enum(['MELEE', 'RANGED', 'MAGIC']);

const attackDefinitionSchema = z.object({
  protoId: z.number().int().nonnegative(),
  name: z.string(),
  weaponIds: z.array(z.number().int()),
  animationIds: z.array(z.number().int()),
  cooldown: z.number().int().nonnegative(),
  projectile: projectileSchema.optional(),
  weaponProjectiles: z.array(weaponProjectileSchema).optional(),
  continuousAnimation: z.boolean().optional(),
  category: categorySchema,
});

const attackDefinitionsSchema = z.array(attackDefinitionSchema);

export type AttackDefinitionJson = z.infer<typeof attackDefinitionSchema>;

// Spell definition schemas.

const graphicSchema = z.object({
  id: z.number().int().nonnegative(),
  durationTicks: z.number().int().nonnegative(),
  maxFrame: z.number().int().nonnegative(),
});

const spellDefinitionSchema = z.object({
  id: z.number().int().nonnegative(),
  name: z.string(),
  animationIds: z.array(z.number().int()),
  graphics: z.array(graphicSchema).optional(),
  targetGraphics: z.array(graphicSchema).optional(),
  stallTicks: z.number().int().nonnegative(),
});

const spellDefinitionsSchema = z.array(spellDefinitionSchema);

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
    this.attackDefinitions = definitions.map(attackJsonToProto);
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
    this.attackDefinitions = validated.map(attackJsonToProto);
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
    this.spellDefinitions = definitions.map(spellJsonToProto);
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
    this.spellDefinitions = validated.map(spellJsonToProto);
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

/**
 * Converts a JSON attack definition to a protobuf AttackDefinition.
 */
function attackJsonToProto(json: AttackDefinitionJson): AttackDefinition {
  const def = new AttackDefinition();
  def.setId(json.protoId as PlayerAttackValue);
  def.setName(json.name);
  def.setWeaponIdsList(json.weaponIds);
  def.setAnimationIdsList(json.animationIds);
  def.setCooldown(json.cooldown);

  if (json.projectile) {
    const proj = new AttackDefinition.Projectile();
    proj.setId(json.projectile.id);
    proj.setStartCycleOffset(json.projectile.startCycleOffset);
    if (json.projectile.weaponId !== undefined) {
      proj.setWeaponId(json.projectile.weaponId);
    }
    def.setProjectile(proj);
  }

  if (json.weaponProjectiles) {
    const projs = json.weaponProjectiles.map((p) => {
      const proj = new AttackDefinition.Projectile();
      proj.setId(p.id);
      proj.setStartCycleOffset(p.startCycleOffset);
      if (p.weaponId !== undefined) {
        proj.setWeaponId(p.weaponId);
      }
      return proj;
    });
    def.setWeaponProjectilesList(projs);
  }

  def.setContinuousAnimation(json.continuousAnimation ?? false);

  switch (json.category) {
    case 'MELEE':
      def.setCategory(AttackDefinition.Category.MELEE);
      break;
    case 'RANGED':
      def.setCategory(AttackDefinition.Category.RANGED);
      break;
    case 'MAGIC':
      def.setCategory(AttackDefinition.Category.MAGIC);
      break;
  }

  return def;
}

/**
 * Converts a JSON spell definition to a protobuf SpellDefinition.
 */
function spellJsonToProto(json: SpellDefinitionJson): SpellDefinition {
  const def = new SpellDefinition();
  def.setId(json.id as PlayerSpellValue);
  def.setName(json.name);
  def.setAnimationIdsList(json.animationIds);

  if (json.graphics) {
    const graphics = json.graphics.map((g) => {
      const graphic = new SpellDefinition.Graphic();
      graphic.setId(g.id);
      graphic.setDurationTicks(g.durationTicks);
      graphic.setMaxFrame(g.maxFrame);
      return graphic;
    });
    def.setGraphicsList(graphics);
  }

  if (json.targetGraphics) {
    const targetGraphics = json.targetGraphics.map((g) => {
      const graphic = new SpellDefinition.Graphic();
      graphic.setId(g.id);
      graphic.setDurationTicks(g.durationTicks);
      graphic.setMaxFrame(g.maxFrame);
      return graphic;
    });
    def.setTargetGraphicsList(targetGraphics);
  }

  def.setStallTicks(json.stallTicks);

  return def;
}
