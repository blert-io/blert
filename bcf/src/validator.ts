import Ajv, { ValidateFunction } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';

// TODO(frolv): Add type versioning.
// When additional BCF versions are added, types should be restructured as:
//
//   - `v1/types.ts`, `v1_1/types.ts`, etc. for versioned types
//   - Top-level exports aliasing the latest version
//   - Versioned namespaces: `import { v1, v1_1 } from './types'`
//
import type {
  BlertChartFormatLax,
  BlertChartFormatStrict,
  BCFAction,
  BCFActor,
  BCFCell,
  BCFCustomRowCell,
  BCFLaxAction,
} from './types';

import schemaV1Strict from '../schemas/bcf-1.0-strict.schema.json';
import schemaV1Lax from '../schemas/bcf-1.x-lax.schema.json';

/** Supported BCF versions. */
export type BCFVersion = '1.0';

/** All known BCF versions. */
export const SUPPORTED_VERSIONS: readonly BCFVersion[] = ['1.0'] as const;

/** The latest BCF version. */
export const LATEST_VERSION: BCFVersion = '1.0';

/**
 * Known action types by version, used for semantic validation.
 * Unknown action types are allowed in lax mode for forward compatibility.
 */
interface VersionActionTypes {
  /** Action types that can only be performed by players. */
  playerActions: ReadonlySet<BCFAction['type']>;
  /** Action types that can only be performed by NPCs. */
  npcActions: ReadonlySet<BCFAction['type']>;
}

const VERSION_ACTION_TYPES: Record<BCFVersion, VersionActionTypes> = {
  '1.0': {
    playerActions: new Set(['attack', 'spell', 'death']),
    npcActions: new Set(['npcAttack']),
  },
};

const LATEST_BY_MAJOR_VERSION: Record<number, BCFVersion> =
  SUPPORTED_VERSIONS.reduce(
    (acc, version) => {
      const parsed = parseVersion(version)!;
      const current = acc[parsed.major];
      if (
        current === undefined ||
        parsed.minor > parseVersion(current)!.minor
      ) {
        acc[parsed.major] = version;
      }
      return acc;
    },
    {} as Record<number, BCFVersion>,
  );

/**
 * Options for BCF validation.
 */
export interface ValidateOptions {
  /**
   * Expected BCF version. If not provided, version is auto-detected from the
   * document. If provided, the document's version must match.
   */
  version?: BCFVersion;

  /**
   * Whether to use strict schema validation.
   *
   * - When `version` is specified, defaults to `true` (strict)
   * - When auto-detecting, defaults to `false` (lax) for forward compatibility
   *
   * In strict mode, documents with unknown properties are rejected.
   * Lax mode allows additional properties for forward compatibility with newer
   * minor BCF versions within the same major version.
   */
  strict?: boolean;
}

/**
 * A validation error with location and message.
 */
export interface ValidationError {
  /**
   * JSON path to the error location (e.g. `"/timeline/ticks/0/cells/0/actorId"`)
   */
  path: string;
  /** Human-readable error message. */
  message: string;
  /** Error category. */
  type: 'schema' | 'semantic';
}

/**
 * Result of validating a BCF document.
 */
export type ValidationResult =
  | { valid: true; document: BlertChartFormatStrict; version: BCFVersion }
  | { valid: true; document: BlertChartFormatLax; version: BCFVersion }
  | { valid: false; errors: ValidationError[] };

export type ValidationResultStrict =
  | { valid: true; document: BlertChartFormatStrict; version: BCFVersion }
  | { valid: false; errors: ValidationError[] };

export type ValidationResultLax =
  | { valid: true; document: BlertChartFormatLax; version: BCFVersion }
  | { valid: false; errors: ValidationError[] };

/** Cache of compiled schema validators by version and strictness. */
const validatorCache = new Map<string, ValidateFunction<BlertChartFormatLax>>();

function parseVersion(
  version: string | null | undefined,
): { major: number; minor: number } | null {
  if (!version) {
    return null;
  }

  const m = /^(\d+)\.(\d+)$/.exec(version);
  if (!m) {
    return null;
  }
  return { major: Number(m[1]), minor: Number(m[2]) };
}

/**
 * Selects the appropriate schema based on version and strictness.
 * In strict mode, uses the strict for the given version.
 * In lax mode, uses the `major.x-lax` schema which allows additional properties
 * and accepts any minor version within the major.
 */
function getSchemaValidator(
  version: BCFVersion,
  strict: boolean,
): ValidateFunction<BlertChartFormatLax> {
  let cacheKey: string;
  if (strict) {
    cacheKey = `${version}-strict`;
  } else {
    const { major } = parseVersion(version)!;
    cacheKey = `${major}.x-lax`; // passes through unknown minor versions
  }

  const cached = validatorCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const ajv = new Ajv({ allErrors: true, strictSchema: false });
  addFormats(ajv);

  let schema: object;
  switch (version) {
    case '1.0':
      schema = strict ? schemaV1Strict : schemaV1Lax;
      break;
    default:
      version satisfies never;
      throw new Error(`Unknown BCF version: ${version as string}`);
  }

  const validator = ajv.compile<BlertChartFormatLax>(schema);
  validatorCache.set(cacheKey, validator);
  return validator;
}

function getDocumentVersion(data: unknown): string | null {
  if (typeof data === 'object' && data !== null && 'version' in data) {
    return typeof data.version === 'string' ? data.version : null;
  }
  return null;
}

function detectKnownVersion(version: string | null): BCFVersion | null {
  if (version === null) {
    return null;
  }

  if (SUPPORTED_VERSIONS.includes(version as BCFVersion)) {
    return version as BCFVersion;
  }

  return null;
}

/**
 * Validates a BCF document against the JSON Schema for a specific version.
 */
function validateSchema(
  data: unknown,
  version: BCFVersion,
  strict: boolean,
): ValidationError[] {
  const validator = getSchemaValidator(version, strict);
  const valid = validator(data);

  if (valid) {
    return [];
  }

  return (validator.errors ?? []).map((error) => ({
    path: error.instancePath,
    message: error.message ?? 'Unknown schema error',
    type: 'schema' as const,
  }));
}

/**
 * Validates semantic constraints that can't be expressed in JSON Schema.
 */
class SemanticValidator {
  private readonly doc: BlertChartFormatLax;
  private readonly errors: ValidationError[] = [];

  private readonly actors = new Map<string, BCFActor['type']>();
  private readonly customRowIds = new Set<string>();
  private readonly allRowIds = new Set<string>();

  private readonly actionTypes: VersionActionTypes;

  constructor(doc: BlertChartFormatLax, version: BCFVersion) {
    this.doc = doc;
    this.actionTypes = VERSION_ACTION_TYPES[version];
  }

  validate(): ValidationError[] {
    this.validateActors();
    this.validateCustomRows();
    this.buildAllRowIds();
    this.validateRowOrder();
    this.validateDisplayRange();
    this.validateTicks();
    this.validateSplits();
    this.validateBackgroundColors();
    return this.errors;
  }

  private error(path: string, message: string): void {
    this.errors.push({ path, message, type: 'semantic' });
  }

  private isTickInBounds(tick: number): boolean {
    return tick >= 0 && tick < this.doc.config.totalTicks;
  }

  private validateActors(): void {
    for (let i = 0; i < this.doc.timeline.actors.length; i++) {
      const actor = this.doc.timeline.actors[i];
      if (this.actors.has(actor.id)) {
        this.error(
          `/timeline/actors/${i}/id`,
          `Duplicate actor ID: "${actor.id}"`,
        );
      }
      this.actors.set(actor.id, actor.type);
    }
  }

  private validateCustomRows(): void {
    const { customRows } = this.doc.augmentation ?? {};
    if (!customRows) {
      return;
    }

    for (let i = 0; i < customRows.length; i++) {
      const row = customRows[i];

      if (this.actors.has(row.id)) {
        this.error(
          `/augmentation/customRows/${i}/id`,
          `Custom row ID "${row.id}" conflicts with actor ID`,
        );
      }
      if (this.customRowIds.has(row.id)) {
        this.error(
          `/augmentation/customRows/${i}/id`,
          `Duplicate custom row ID: "${row.id}"`,
        );
      }
      this.customRowIds.add(row.id);

      this.validateCustomRowCells(row.cells, row.id, i);
    }
  }

  private validateCustomRowCells(
    cells: BCFCustomRowCell[],
    rowId: string,
    rowIndex: number,
  ): void {
    const seenTicks = new Set<number>();
    let lastTick: number | null = null;

    for (let j = 0; j < cells.length; j++) {
      const cell = cells[j];
      const path = `/augmentation/customRows/${rowIndex}/cells/${j}/tick`;

      if (!this.isTickInBounds(cell.tick)) {
        this.error(
          path,
          `Tick ${cell.tick} is out of bounds [0, ${this.doc.config.totalTicks})`,
        );
      }
      if (seenTicks.has(cell.tick)) {
        this.error(
          path,
          `Duplicate tick number ${cell.tick} in custom row "${rowId}"`,
        );
      }
      seenTicks.add(cell.tick);

      if (lastTick !== null && cell.tick < lastTick) {
        this.error(
          path,
          `Tick ${cell.tick} is out of order (previous tick was ${lastTick})`,
        );
      }
      lastTick = cell.tick;
    }
  }

  private buildAllRowIds(): void {
    for (const id of this.actors.keys()) {
      this.allRowIds.add(id);
    }
    for (const id of this.customRowIds) {
      this.allRowIds.add(id);
    }
  }

  private validateRowOrder(): void {
    const { rowOrder } = this.doc.config;
    if (!rowOrder) {
      return;
    }

    for (let i = 0; i < rowOrder.length; i++) {
      const rowId = rowOrder[i];
      if (!this.allRowIds.has(rowId)) {
        this.error(
          `/config/rowOrder/${i}`,
          `Row ID "${rowId}" does not reference an actor or custom row`,
        );
      }
    }
  }

  private validateDisplayRange(): void {
    const { totalTicks, startTick, endTick } = this.doc.config;

    if (startTick !== undefined) {
      if (startTick < 0 || startTick >= totalTicks) {
        this.error(
          '/config/startTick',
          `startTick is out of bounds [0, ${totalTicks})`,
        );
      }
      if (endTick !== undefined && startTick > endTick) {
        this.error(
          '/config/startTick',
          `startTick must be less than or equal to endTick`,
        );
      }
    }

    if (endTick !== undefined) {
      if (endTick < 0 || endTick >= totalTicks) {
        this.error(
          '/config/endTick',
          `endTick is out of bounds [0, ${totalTicks})`,
        );
      }
    }
  }

  private validateTicks(): void {
    const { ticks } = this.doc.timeline;
    const seenTicks = new Set<number>();
    let lastTick: number | null = null;

    for (let i = 0; i < ticks.length; i++) {
      const tick = ticks[i];

      if (seenTicks.has(tick.tick)) {
        this.error(
          `/timeline/ticks/${i}/tick`,
          `Duplicate tick number: ${tick.tick}`,
        );
      }
      seenTicks.add(tick.tick);

      if (lastTick !== null && tick.tick < lastTick) {
        this.error(
          `/timeline/ticks/${i}/tick`,
          `Tick ${tick.tick} is out of order (previous tick was ${lastTick})`,
        );
      }
      lastTick = tick.tick;

      if (!this.isTickInBounds(tick.tick)) {
        this.error(
          `/timeline/ticks/${i}/tick`,
          `Tick ${tick.tick} is out of bounds [0, ${this.doc.config.totalTicks})`,
        );
      }

      this.validateCells(tick.cells, i);
    }
  }

  private validateCells(
    cells: BCFCell<BCFLaxAction>[],
    tickIndex: number,
  ): void {
    const seenActorIds = new Set<string>();

    for (let j = 0; j < cells.length; j++) {
      const cell = cells[j];

      if (seenActorIds.has(cell.actorId)) {
        this.error(
          `/timeline/ticks/${tickIndex}/cells/${j}/actorId`,
          `Duplicate actor ID "${cell.actorId}" in tick`,
        );
      }
      seenActorIds.add(cell.actorId);

      this.validateCell(cell, tickIndex, j);
    }
  }

  private validateCell(
    cell: BCFCell<BCFLaxAction>,
    tickIndex: number,
    cellIndex: number,
  ): void {
    if (!this.actors.has(cell.actorId)) {
      this.error(
        `/timeline/ticks/${tickIndex}/cells/${cellIndex}/actorId`,
        `Actor ID "${cell.actorId}" does not exist`,
      );
    }

    if (cell.actions) {
      this.validateActions(cell.actions, cell.actorId, tickIndex, cellIndex);
    }
  }

  private validateActions(
    actions: BCFLaxAction[],
    actorId: string,
    tickIndex: number,
    cellIndex: number,
  ): void {
    const cellActorType = this.actors.get(actorId);
    const actionTypes = new Set<string>();

    for (let k = 0; k < actions.length; k++) {
      const action = actions[k];
      const path = `/timeline/ticks/${tickIndex}/cells/${cellIndex}/actions/${k}`;

      // Only validate actor-type constraints for known action types.
      // Unknown action types are allowed for any actor.
      if (cellActorType !== undefined) {
        const actionType = action.type as BCFAction['type'];
        if (
          this.actionTypes.npcActions.has(actionType) &&
          cellActorType !== 'npc'
        ) {
          this.error(
            path,
            `${cellActorType} actor cannot perform "${action.type}" action`,
          );
        } else if (
          this.actionTypes.playerActions.has(actionType) &&
          cellActorType !== 'player'
        ) {
          this.error(
            path,
            `${cellActorType} actor cannot perform "${action.type}" action`,
          );
        }
      }

      if (actionTypes.has(action.type)) {
        this.error(path, `Duplicate action type "${action.type}" in cell`);
      }
      actionTypes.add(action.type);

      const targetActorId = getTargetActorId(action);
      if (targetActorId !== undefined && !this.actors.has(targetActorId)) {
        this.error(
          `${path}/targetActorId`,
          `Target actor ID "${targetActorId}" does not exist`,
        );
      }
    }
  }

  private validateSplits(): void {
    const { splits } = this.doc.augmentation ?? {};
    if (!splits) {
      return;
    }

    for (let i = 0; i < splits.length; i++) {
      const split = splits[i];
      if (!this.isTickInBounds(split.tick)) {
        this.error(
          `/augmentation/splits/${i}/tick`,
          `Split tick ${split.tick} is out of bounds [0, ${this.doc.config.totalTicks})`,
        );
      }
    }
  }

  private validateBackgroundColors(): void {
    const { backgroundColors } = this.doc.augmentation ?? {};
    if (!backgroundColors) {
      return;
    }

    const { totalTicks } = this.doc.config;
    for (let i = 0; i < backgroundColors.length; i++) {
      const bg = backgroundColors[i];
      const length = bg.length ?? 1;
      const bgEndTick = bg.tick + length - 1;

      if (!this.isTickInBounds(bg.tick)) {
        this.error(
          `/augmentation/backgroundColors/${i}/tick`,
          `Background color tick ${bg.tick} is out of bounds [0, ${totalTicks})`,
        );
      }
      if (bgEndTick >= totalTicks) {
        this.error(
          `/augmentation/backgroundColors/${i}/length`,
          `Background color extends past timeline (ends at tick ${bgEndTick}, max is ${totalTicks - 1})`,
        );
      }
      if (bg.rowIds) {
        for (let j = 0; j < bg.rowIds.length; j++) {
          if (!this.allRowIds.has(bg.rowIds[j])) {
            this.error(
              `/augmentation/backgroundColors/${i}/rowIds/${j}`,
              `Row ID "${bg.rowIds[j]}" does not reference an actor or custom row`,
            );
          }
        }
      }
    }
  }
}

function getTargetActorId<ActionType extends { type: string }>(
  action: ActionType,
): string | undefined {
  if (!('targetActorId' in action)) {
    return undefined;
  }

  return typeof action.targetActorId === 'string'
    ? action.targetActorId
    : undefined;
}

function validateSemantics(
  doc: BlertChartFormatLax,
  version: BCFVersion,
): ValidationError[] {
  return new SemanticValidator(doc, version).validate();
}

/**
 * Validates a BCF document.
 *
 * @param data The data to validate.
 * @param options Validation options.
 * @returns A result object indicating validity, the validated document, and
 *   the detected version.
 *
 * @example
 * ```typescript
 * // Auto-detect version from the document, using lax mode for forward
 * // compatibility.
 * const result = validate(data);
 *
 * // Validate against a specific version, using strict mode by default.
 * const result = validate(data, { version: '1.0' });
 *
 * if (result.valid) {
 *   console.log(result.document, result.version);
 * } else {
 *   console.error(result.errors);
 * }
 * ```
 */
export function validate(
  data: unknown,
  options: ValidateOptions & { strict: true },
): ValidationResultStrict;

export function validate(
  data: unknown,
  options: ValidateOptions & { version: BCFVersion; strict?: true },
): ValidationResultStrict;

export function validate(
  data: unknown,
  options: ValidateOptions & { strict: false },
): ValidationResultLax;

export function validate(
  data: unknown,
  options?: { version?: undefined; strict?: undefined },
): ValidationResultLax;

export function validate(
  data: unknown,
  options?: ValidateOptions,
): ValidationResultStrict | ValidationResultLax;

export function validate(
  data: unknown,
  options?: ValidateOptions,
): ValidationResultStrict | ValidationResultLax {
  const strict = options?.strict ?? options?.version !== undefined;

  const documentVersion = getDocumentVersion(data);
  let detectedVersion = detectKnownVersion(documentVersion);

  // To allow forward compatibility in lax mode, parse against the latest known
  // version for the same major version as the document version.
  if (!strict && options?.version === undefined && detectedVersion === null) {
    const parsed = parseVersion(documentVersion);
    if (parsed !== null) {
      detectedVersion = LATEST_BY_MAJOR_VERSION[parsed.major] ?? null;
    }
  }

  if (options?.version !== undefined) {
    if (detectedVersion !== options.version) {
      return {
        valid: false,
        errors: [
          {
            path: '/version',
            message:
              detectedVersion === null
                ? `Document version "${documentVersion}" is not supported. Expected "${options.version}".`
                : `Document version "${detectedVersion as string}" does not match expected version "${options.version}".`,
            type: 'schema',
          },
        ],
      };
    }
  } else if (detectedVersion === null) {
    return {
      valid: false,
      errors: [
        {
          path: '/version',
          message:
            documentVersion === null
              ? 'Missing required field: version'
              : `Unsupported BCF version: "${documentVersion}". Supported versions: ${SUPPORTED_VERSIONS.join(', ')}`,
          type: 'schema',
        },
      ],
    };
  }

  const version = options?.version ?? detectedVersion;

  const schemaErrors = validateSchema(data, version, strict);
  if (schemaErrors.length > 0) {
    return { valid: false, errors: schemaErrors };
  }

  const doc = data as BlertChartFormatLax;

  const semanticErrors = validateSemantics(doc, version);
  if (semanticErrors.length > 0) {
    return { valid: false, errors: semanticErrors };
  }

  return { valid: true, document: doc, version };
}

/**
 * Parses a JSON string and validates it as a BCF document.
 *
 * @param json The JSON string to parse and validate.
 * @param options Validation options.
 * @returns A result object indicating validity and any errors.
 *
 * @example
 * ```typescript
 * const result = parseAndValidate(jsonString);
 * if (result.valid) {
 *   console.log(result.document);
 * }
 * ```
 */
export function parseAndValidate(
  json: string,
  options: ValidateOptions & { strict: true },
): ValidationResultStrict;

export function parseAndValidate(
  json: string,
  options: ValidateOptions & { version: BCFVersion; strict?: true },
): ValidationResultStrict;

export function parseAndValidate(
  json: string,
  options: ValidateOptions & { strict: false },
): ValidationResultLax;

export function parseAndValidate(
  json: string,
  options?: { version?: undefined; strict?: undefined },
): ValidationResultLax;

export function parseAndValidate(
  json: string,
  options?: ValidateOptions,
): ValidationResultStrict | ValidationResultLax {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch (e) {
    return {
      valid: false,
      errors: [
        {
          path: '/',
          message: `Invalid JSON: ${e instanceof Error ? e.message : 'Parse error'}`,
          type: 'schema',
        },
      ],
    };
  }

  return validate(data, options);
}
