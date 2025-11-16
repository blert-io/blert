import fs from 'fs';
import path from 'path';
import postgres, { Sql } from 'postgres';

export type MigrationRunnerOptions = {
  dbUriEnvVar: string;
  migrationsDir: string;
  tableName?: string;
};

const MIGRATION_TEMPLATE = `import { Sql } from 'postgres';

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
  } catch (e: any) {
    await sql`
      CREATE TABLE ${sql(tableName)} (name TEXT PRIMARY KEY, run_at TIMESTAMPTZ)
    `;
  }
}

async function migrateFile(sql: Sql, path: string) {
  const { migrate } = await import(path);
  await migrate(sql);
}

function createMigration(dir: string, name: string) {
  const date = new Date();
  let timestamp = date.getUTCFullYear().toString();
  timestamp += (date.getUTCMonth() + 1).toString().padStart(2, '0');
  timestamp += date.getUTCDate().toString().padStart(2, '0');
  timestamp += date.getUTCHours().toString().padStart(2, '0');
  timestamp += date.getUTCMinutes().toString().padStart(2, '0');
  timestamp += date.getUTCSeconds().toString().padStart(2, '0');

  const migrationName = `${timestamp}-${name}`;
  const sourceFile = path.join(distToSrc(dir), `${migrationName}.ts`);

  fs.writeFileSync(sourceFile, MIGRATION_TEMPLATE);
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

  let scriptMain: (sql: Sql, args: string[]) => Promise<void>;
  try {
    scriptMain = (await import(fullPath)).scriptMain;
  } catch (e: any) {
    throw new Error(
      `Script "${srcPath}" does not export a scriptMain function`,
    );
  }

  await scriptMain(sql, process.argv.slice(4));
}

export async function runMigrationsCli(options: MigrationRunnerOptions) {
  const { dbUriEnvVar, migrationsDir, tableName = 'migrations' } = options;
  const command = process.argv[2];

  if (command === 'create') {
    if (process.argv.length !== 4) {
      throw new Error(`Usage: ${process.argv[1]} create <migration-name>`);
    }
    createMigration(migrationsDir, process.argv[3]);
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
  const migrationsToRun: Array<{ name: string; path: string }> = [];
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

  await sql.begin(async (sql) => {
    let i = 0;
    for (const { name, path } of migrationsToRun) {
      ++i;
      console.log(`Running migration ${name} [${i}/${migrationsToRun.length}]`);

      await migrateFile(sql, path);
      await sql`INSERT INTO ${sql(tableName)} (name, run_at) VALUES (${name}, NOW())`;
    }
  });
}
