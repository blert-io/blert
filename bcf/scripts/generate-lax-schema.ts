#!/usr/bin/env npx ts-node

/**
 * Generates lax schemas from strict schemas.
 *
 * Lax schemas allow additional properties for forward compatibility with newer
 * minor versions. They also accept any minor version within the same major.
 */

import * as fs from 'fs';
import * as path from 'path';

const USAGE = `
Usage:
  npx ts-node scripts/generate-lax-schema.ts
  npx ts-node scripts/generate-lax-schema.ts --major 1
  npx ts-node scripts/generate-lax-schema.ts --schema schemas/bcf-1.0-strict.schema.json

Options:
  --major <version>   Generate lax schema for a specific major version
  --schema <file>     Generate lax schema from a specific strict schema file
  --help, -h          Show this help message
`.trim();

const SCHEMAS_DIR = path.join(__dirname, '../schemas');

interface CliArgs {
  major?: number;
  schemaFile?: string;
}

function parseArgs(): CliArgs {
  const args: CliArgs = {};
  const argv = process.argv.slice(2);

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--major' && argv[i + 1]) {
      args.major = parseInt(argv[i + 1], 10);
      if (isNaN(args.major)) {
        console.error(`Invalid major version: ${argv[i + 1]}`);
        process.exit(1);
      }
      i++;
    } else if (argv[i] === '--schema' && argv[i + 1]) {
      args.schemaFile = argv[i + 1];
      i++;
    } else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log(USAGE);
      process.exit(0);
    }
  }

  return args;
}

type SchemaObject = Record<string, unknown>;

/**
 * Recursively removes `additionalProperties: false` from all objects in the
 * schema.
 */
function removeAdditionalPropertiesFalse(obj: unknown): unknown {
  if (Array.isArray(obj)) {
    return obj.map(removeAdditionalPropertiesFalse);
  }

  if (typeof obj === 'object' && obj !== null) {
    const result: SchemaObject = {};
    for (const [key, value] of Object.entries(obj)) {
      if (key === 'additionalProperties' && value === false) {
        continue;
      }
      result[key] = removeAdditionalPropertiesFalse(value);
    }
    return result;
  }

  return obj;
}

/**
 * Converts a strict version constraint to a lax pattern.
 * e.g. `{ const: "1.0" }` becomes `{ type: "string", pattern: "^1\\.\\d+$" }`
 */
function relaxVersionConstraint(
  schema: SchemaObject,
  majorVersion: number,
): void {
  if (schema.properties && typeof schema.properties === 'object') {
    const props = schema.properties as SchemaObject;
    if (props.version && typeof props.version === 'object') {
      const version = props.version as SchemaObject;
      if ('const' in version) {
        props.version = {
          type: 'string',
          pattern: `^${majorVersion}\\.\\d+$`,
        };
      }
    }
  }
}

/**
 * Extracts the action type string from a $ref to an action definition.
 * e.g. `{ "$ref": "#/$defs/attackAction" }` -> `"attack"`
 */
function extractActionType(
  ref: unknown,
  defs: SchemaObject,
): string | undefined {
  if (typeof ref !== 'object' || ref === null) {
    return undefined;
  }

  const refObj = ref as SchemaObject;
  const refPath = refObj.$ref;
  if (typeof refPath !== 'string') {
    return undefined;
  }

  // Extract definition name from ref path.
  const match = /^#\/\$defs\/(.+)$/.exec(refPath);
  if (!match) {
    return undefined;
  }

  const defName = match[1];
  const def = defs[defName];
  if (typeof def !== 'object' || def === null) {
    return undefined;
  }

  // Extract and return `type.const` from the definition's properties.
  const defObj = def as SchemaObject;
  const props = defObj.properties;
  if (typeof props !== 'object' || props === null) {
    return undefined;
  }

  const typeProp = (props as SchemaObject).type;
  if (typeof typeProp !== 'object' || typeProp === null) {
    return undefined;
  }

  const constValue = (typeProp as SchemaObject).const;
  return typeof constValue === 'string' ? constValue : undefined;
}

/**
 * Patches `action.type` to accept any string value that is not already a
 * recognized action type. Dynamically extracts known types from the schema.
 */
function relaxActionUnion(schema: SchemaObject): void {
  const defs = schema.$defs;
  if (!defs || typeof defs !== 'object') {
    return;
  }

  const actionDef = (defs as SchemaObject).action;
  if (!actionDef || typeof actionDef !== 'object') {
    return;
  }

  const action = actionDef as SchemaObject;
  const oneOf = action.oneOf;
  if (!Array.isArray(oneOf)) {
    return;
  }

  // Extract known action types from the oneOf refs.
  const knownTypes = oneOf
    .map((ref) => extractActionType(ref, defs as SchemaObject))
    .filter((t) => t !== undefined);

  if (knownTypes.length === 0) {
    console.warn('Warning: Could not extract action types from schema');
    return;
  }

  delete action.oneOf;
  action.anyOf = [
    { oneOf },
    {
      type: 'object',
      required: ['type'],
      properties: {
        type: {
          type: 'string',
          not: { enum: knownTypes },
        },
      },
    },
  ];
}

/**
 * Updates schema metadata for lax version.
 */
function updateMetadata(
  schema: SchemaObject,
  majorVersion: number,
  source: string,
): void {
  schema.$id = `https://blert.io/schemas/bcf-${majorVersion}.x-lax.schema.json`;
  schema.title = `Blert Chart Format (BCF) ${majorVersion}.x Lax`;
  schema.$comment = `Generated from ${path.basename(source)}. Do not edit manually.`;
}

function generateLaxSchema(strictSchemaPath: string): void {
  const filename = path.basename(strictSchemaPath);
  const match = /^bcf-(\d+)\.(\d+)-strict\.schema\.json$/.exec(filename);

  if (!match) {
    console.error(`Invalid schema filename: ${filename}`);
    process.exit(1);
  }

  const majorVersion = parseInt(match[1], 10);

  console.log(`Generating lax schema for major version ${majorVersion}...`);

  const strictSchema = JSON.parse(
    fs.readFileSync(strictSchemaPath, 'utf-8'),
  ) as SchemaObject;

  const laxSchema = removeAdditionalPropertiesFalse(
    strictSchema,
  ) as SchemaObject;

  relaxVersionConstraint(laxSchema, majorVersion);
  relaxActionUnion(laxSchema);
  updateMetadata(laxSchema, majorVersion, strictSchemaPath);

  const outputPath = path.join(
    SCHEMAS_DIR,
    `bcf-${majorVersion}.x-lax.schema.json`,
  );

  fs.writeFileSync(outputPath, JSON.stringify(laxSchema, null, 2) + '\n');

  console.log(`Generated: ${outputPath}`);
}

function findLatestStrictSchemas(): Map<number, string> {
  const files = fs.readdirSync(SCHEMAS_DIR);
  const strictSchemas = files.filter((f) =>
    /^bcf-\d+\.\d+-strict\.schema\.json$/.test(f),
  );

  if (strictSchemas.length === 0) {
    console.error('No strict schemas found in schemas/');
    process.exit(1);
  }

  const latestByMajor = new Map<number, { minor: number; filename: string }>();

  for (const filename of strictSchemas) {
    const match = /^bcf-(\d+)\.(\d+)-strict\.schema\.json$/.exec(filename);
    if (match) {
      const major = parseInt(match[1], 10);
      const minor = parseInt(match[2], 10);
      const current = latestByMajor.get(major);
      if (!current || minor > current.minor) {
        latestByMajor.set(major, { minor, filename });
      }
    }
  }

  return new Map(
    Array.from(latestByMajor.entries()).map(([major, { filename }]) => [
      major,
      path.join(SCHEMAS_DIR, filename),
    ]),
  );
}

function main(): void {
  const args = parseArgs();

  if (args.schemaFile) {
    const schemaPath = path.isAbsolute(args.schemaFile)
      ? args.schemaFile
      : path.join(process.cwd(), args.schemaFile);

    if (!fs.existsSync(schemaPath)) {
      console.error(`Schema file not found: ${schemaPath}`);
      process.exit(1);
    }

    generateLaxSchema(schemaPath);
    console.log('Done.');
    return;
  }

  const latestByMajor = findLatestStrictSchemas();

  if (args.major !== undefined) {
    const schemaPath = latestByMajor.get(args.major);
    if (!schemaPath) {
      console.error(`No strict schema found for major version ${args.major}`);
      console.error(
        `Available major versions: ${Array.from(latestByMajor.keys()).join(', ')}`,
      );
      process.exit(1);
    }
    generateLaxSchema(schemaPath);
  } else {
    for (const schemaPath of latestByMajor.values()) {
      generateLaxSchema(schemaPath);
    }
  }

  console.log('Done.');
}

main();
