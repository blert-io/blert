import { DataRepository } from '@blert/common';
import { PlayerAttackMap } from '@blert/common/generated/event_pb';
import {
  AttackDefinition,
  ServerMessage,
} from '@blert/common/generated/server_message_pb';
import { readFile } from 'fs/promises';
import { z } from 'zod';

import logger from './log';

type PlayerAttackValue = PlayerAttackMap[keyof PlayerAttackMap];

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

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export function validateDefinitions(data: unknown): AttackDefinitionJson[] {
  const result = attackDefinitionsSchema.safeParse(data);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue.path.length > 0 ? issue.path.join('.') : '';
    const message = path ? `${path}: ${issue.message}` : issue.message;
    throw new ValidationError(message);
  }
  return result.data;
}

/** Repository path for the current attack definitions. */
const DEFINITIONS_PATH = 'attack-definitions/current.json';

/** Repository path for a versioned backup of the attack definitions. */
function timestampedPath(date: Date): string {
  return `attack-definitions/v${date.toISOString().replace(/[:.]/g, '-')}.json`;
}

export class AttackRepository {
  private definitions: AttackDefinition[] = [];
  private jsonDefinitions: AttackDefinitionJson[] = [];
  private repository: DataRepository | null;
  private localFallbackPath: string;

  /**
   * @param repository Optional DataRepository for storing/loading definitions.
   *   If not provided, only the local fallback is used.
   * @param localFallbackPath Path to a local JSON file to use as fallback.
   */
  constructor(repository: DataRepository | null, localFallbackPath: string) {
    this.repository = repository;
    this.localFallbackPath = localFallbackPath;
  }

  /**
   * Initializes the attack repository by loading definitions from the
   * configured data repository or local fallback file.
   */
  public async initialize(): Promise<void> {
    await this.reload();
  }

  /**
   * Reloads definitions from the repository, falling back to the local file
   * if the repository is unavailable or not configured.
   */
  public async reload(): Promise<void> {
    let jsonDefinitions: AttackDefinitionJson[] | null = null;

    if (this.repository !== null) {
      try {
        const data = await this.repository.loadRaw(DEFINITIONS_PATH);
        const parsed: unknown = JSON.parse(new TextDecoder().decode(data));
        jsonDefinitions = validateDefinitions(parsed);
        logger.info('attack_definitions_loaded', {
          source: 'repository',
          count: jsonDefinitions.length,
        });
      } catch (e) {
        if (!(e instanceof DataRepository.NotFound)) {
          logger.warn('attack_definitions_repository_load_failed', {
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    }

    if (jsonDefinitions === null) {
      try {
        const data = await readFile(this.localFallbackPath, 'utf8');
        const parsed: unknown = JSON.parse(data);
        jsonDefinitions = validateDefinitions(parsed);
        logger.info('attack_definitions_loaded', {
          source: 'local_fallback',
          path: this.localFallbackPath,
          count: jsonDefinitions.length,
        });
      } catch (e) {
        logger.error('attack_definitions_local_load_failed', {
          path: this.localFallbackPath,
          error: e instanceof Error ? e.message : String(e),
        });
        throw new Error(
          `Failed to load attack definitions from ${this.localFallbackPath}`,
        );
      }
    }

    this.updateDefinitions(jsonDefinitions);
  }

  /**
   * Returns the current attack definitions as protobuf objects.
   */
  public getDefinitions(): AttackDefinition[] {
    return this.definitions;
  }

  /**
   * Returns the current attack definitions as JSON objects.
   */
  public getDefinitionsJson(): AttackDefinitionJson[] {
    return this.jsonDefinitions;
  }

  /**
   * Creates a ServerMessage containing all current attack definitions.
   */
  public createDefinitionsMessage(): ServerMessage {
    const message = new ServerMessage();
    message.setType(ServerMessage.Type.ATTACK_DEFINITIONS);
    message.setAttackDefinitionsList(this.definitions);
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
  public async uploadDefinitions(definitions: unknown): Promise<void> {
    if (this.repository === null) {
      throw new Error('No repository configured for upload');
    }

    const validated = validateDefinitions(definitions);

    const jsonData = JSON.stringify(validated, null, 2);
    const data = new TextEncoder().encode(jsonData);

    const backupPath = timestampedPath(new Date());
    await this.repository.saveRaw(backupPath, data);

    await this.repository.saveRaw(DEFINITIONS_PATH, data);
    logger.info('attack_definitions_uploaded', {
      backupPath,
      count: validated.length,
    });

    this.updateDefinitions(validated);
  }

  private updateDefinitions(definitions: AttackDefinitionJson[]): void {
    this.definitions = definitions.map(jsonToProto);
    this.jsonDefinitions = definitions;
  }
}

/**
 * Converts a JSON attack definition to a protobuf AttackDefinition.
 */
function jsonToProto(json: AttackDefinitionJson): AttackDefinition {
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
