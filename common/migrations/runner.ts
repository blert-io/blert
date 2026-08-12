import fs from 'fs';
import path from 'path';
import postgres, { Sql, TransactionSql } from 'postgres';

export type MigrationRunnerOptions = {
  dbUriEnvVar: string;
  migrationsDir: string;
  tableName?: string;
};

const MIGRATION_TEMPLATE = `import { TransactionSql } from 'postgres';

export async function migrate(sql: TransactionSql) {
  // Write your migration here
}
`;

const NON_TRANSACTIONAL_MIGRATION_TEMPLATE = `import { Sql } from 'postgres';

export const transactional = false;

export async function migrate(sql: Sql) {
  // Write your migration here
}
`;

/**
 * Converts a path in the `dist` directory to a path in the `src` directory.
 * @param dir Path of the path in the `dist` directory.
 * @returns Path of the path in the `src` directory.
 */
export function distToSrc(dir: string): string {
  return dir
    .split(path.sep)
    .filter((p) => p !== 'dist')
    .join(path.sep);
}

/**
 * Converts a file in the `dist` directory to a file in the `src` directory.
 * @param file Path of the file in the `dist` directory.
 * @returns Path of the file in the `src` directory.
 */
export function distToSrcFile(file: string): string {
  const dirname = path.dirname(file);
  const basename = path.basename(file);
  return `${distToSrc(dirname)}/${basename.replace(/\.js$/, '.ts')}`;
}

async function ensureMigrationsTable(sql: Sql, tableName: string) {
  try {
    await sql`SELECT * FROM ${sql(tableName)} LIMIT 1;`;
  } catch {
    await sql`
      CREATE TABLE ${sql(tableName)} (name TEXT PRIMARY KEY, run_at TIMESTAMPTZ)
    `;
  }
}

type MigrationSql = Sql | TransactionSql;

/**
 * A resolved migration module.
 * A migration runs inside a transaction unless it exports
 * `transactional = false`.
 */
type LoadedMigration = {
  name: string;
  migrate: (sql: MigrationSql) => Promise<void>;
  transactional: boolean;
};

/**
 * Loads a migration module.
 *
 * @param name Name of the migration.
 * @param path Path to the migration's compiled module.
 * @returns The loaded migration.
 */
async function loadMigration(
  name: string,
  path: string,
): Promise<LoadedMigration> {
  const mod = (await import(path)) as {
    migrate: (sql: MigrationSql) => Promise<void>;
    transactional?: boolean;
  };
  return {
    name,
    migrate: mod.migrate,
    transactional: mod.transactional ?? true,
  };
}

function createMigration(dir: string, name: string, transactional: boolean) {
  const date = new Date();
  let timestamp = date.getUTCFullYear().toString();
  timestamp += (date.getUTCMonth() + 1).toString().padStart(2, '0');
  timestamp += date.getUTCDate().toString().padStart(2, '0');
  timestamp += date.getUTCHours().toString().padStart(2, '0');
  timestamp += date.getUTCMinutes().toString().padStart(2, '0');
  timestamp += date.getUTCSeconds().toString().padStart(2, '0');

  const migrationName = `${timestamp}-${name}`;
  const sourceFile = path.join(distToSrc(dir), `${migrationName}.ts`);

  fs.writeFileSync(
    sourceFile,
    transactional ? MIGRATION_TEMPLATE : NON_TRANSACTIONAL_MIGRATION_TEMPLATE,
  );
  console.log(`Created migration ${migrationName} at ${sourceFile}`);
}

async function runScript(dir: string, script: string, sql: Sql) {
  if (!script.endsWith('.js')) {
    script += '.js';
  }

  const fullPath = path.join(dir, script);
  const srcPath = distToSrcFile(fullPath);
  if (!fs.existsSync(srcPath)) {
    throw new Error(`Script "${srcPath}" not found`);
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require(fullPath) as {
    scriptMain?: (sql: Sql, args: string[]) => Promise<void>;
  };
  if (typeof mod.scriptMain !== 'function') {
    throw new Error(
      `Script "${srcPath}" does not export a scriptMain function`,
    );
  }
  await mod.scriptMain(sql, process.argv.slice(4));
}

export async function runMigrationsCli(options: MigrationRunnerOptions) {
  const { dbUriEnvVar, migrationsDir, tableName = 'migrations' } = options;
  const command = process.argv[2];

  if (command === 'create') {
    const args = process.argv.slice(3);
    const names = args.filter((arg) => !arg.startsWith('--'));
    if (names.length !== 1) {
      throw new Error(
        `Usage: ${process.argv[1]} create <migration-name> [--no-transaction]`,
      );
    }
    createMigration(
      migrationsDir,
      names[0],
      !args.includes('--no-transaction'),
    );
    return;
  }

  const uri = process.env[dbUriEnvVar];
  if (!uri) {
    throw new Error(`${dbUriEnvVar} environment variable is required`);
  }

  const sql = postgres(uri);

  if (command === 'script') {
    if (process.argv.length < 4) {
      throw new Error(
        `Usage: ${process.argv[1]} script <script-name> [script-args...]`,
      );
    }
    const scriptName = process.argv[3];
    await runScript(migrationsDir, scriptName, sql);
    return;
  }

  await ensureMigrationsTable(sql, tableName);
  const [latestMigration] = await sql`
    SELECT name FROM ${sql(tableName)} ORDER BY name DESC LIMIT 1
  `;

  const migrationFileRegex = /^(\d{14}-[a-zA-Z0-9\-]+)\.js$/;
  const migrationsToRun: { name: string; path: string }[] = [];
  const files = fs.readdirSync(migrationsDir);

  for (const file of files) {
    const match = migrationFileRegex.exec(file);
    if (match === null) {
      continue;
    }

    const fullPath = path.join(migrationsDir, file);
    if (!fs.existsSync(distToSrcFile(fullPath))) {
      continue;
    }

    const migrationName = match[1];
    if (latestMigration === undefined || migrationName > latestMigration.name) {
      migrationsToRun.push({ name: migrationName, path: fullPath });
    }
  }

  if (migrationsToRun.length === 0) {
    console.log('No migrations to run');
    return;
  }

  migrationsToRun.sort((a, b) => a.name.localeCompare(b.name));

  const migrations = await Promise.all(
    migrationsToRun.map(({ name, path }) => loadMigration(name, path)),
  );

  // Partition the list into sections of consecutive transactional migrations,
  // which run together under a shared DB transaction, and non-transactional
  // ones, which cannot.
  const segments: LoadedMigration[][] = [];
  for (const migration of migrations) {
    const current = segments[segments.length - 1];
    if (
      current !== undefined &&
      current[0].transactional &&
      migration.transactional
    ) {
      current.push(migration);
    } else {
      segments.push([migration]);
    }
  }

  let i = 0;
  const run = async (sql: MigrationSql, migration: LoadedMigration) => {
    ++i;
    console.log(
      `Running migration ${migration.name} [${i}/${migrations.length}]`,
    );
    await migration.migrate(sql);
    await sql`
      INSERT INTO ${sql(tableName)} (name, run_at)
      VALUES (${migration.name}, NOW())
    `;
  };

  for (const segment of segments) {
    if (segment[0].transactional) {
      await sql.begin(async (tx) => {
        for (const migration of segment) {
          await run(tx, migration);
        }
      });
    } else {
      await run(sql, segment[0]);
    }
  }
}
