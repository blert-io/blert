import fs from 'fs';
import path from 'path';
import postgres from 'postgres';

async function ensureMigrationsTable(sql: postgres.Sql) {
  try {
    await sql`SELECT * FROM migrations LIMIT 1;`;
  } catch (e: any) {
    await sql`
      CREATE TABLE migrations (name TEXT PRIMARY KEY, run_at TIMESTAMPTZ)
    `;
  }
}

async function migrateFile(sql: postgres.Sql, path: string, name: string) {
  const { migrate } = await import(path);
  await migrate(sql);
}

const MIGRATION_TEMPLATE = `import { Sql } from 'postgres';

export async function migrate(sql: Sql) {
  // Write your migration here
}
`;

function distToSrc(dir: string): string {
  return dir
    .split(path.sep)
    .filter((p) => p !== 'dist')
    .join(path.sep);
}

function distToSrcFile(file: string): string {
  const dirname = path.dirname(file);
  const basename = path.basename(file);
  return `${distToSrc(dirname)}/${basename.replace(/\.js$/, '.ts')}`;
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

async function runScript(dir: string, script: string, sql: postgres.Sql) {
  let scriptMain: (sql: postgres.Sql, args: string[]) => Promise<void>;

  script = path.join(dir, script);
  if (!script.endsWith('.js')) {
    script += '.js';
  }

  const scriptPath = distToSrcFile(script);
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`Script "${scriptPath}" not found`);
  }

  try {
    scriptMain = (await import(script)).scriptMain;
  } catch (e: any) {
    throw new Error(
      `Script "${scriptPath}" does not export a scriptMain function`,
    );
  }

  await scriptMain(sql, process.argv.slice(4));
}

async function main() {
  const migrationsDir = __dirname;

  if (process.argv[2] === 'create') {
    if (process.argv.length !== 4) {
      throw new Error(`Usage: ${process.argv[1]} create <migration-name>`);
    }
    createMigration(migrationsDir, process.argv[3]);
    return;
  }

  if (!process.env.BLERT_DATABASE_URI) {
    throw new Error('BLERT_DATABASE_URI environment variable is required');
  }

  const sql = postgres(process.env.BLERT_DATABASE_URI);

  if (process.argv[2] === 'script') {
    if (process.argv.length < 4) {
      throw new Error(
        `Usage: ${process.argv[1]} script <script-name> [script-args...]`,
      );
    }
    const script = process.argv[3];
    await runScript(migrationsDir, script, sql);
    return;
  }

  await ensureMigrationsTable(sql);
  const [latestMigration] = await sql`
    SELECT name FROM migrations ORDER BY name DESC LIMIT 1
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

    const migrationName = match![1];
    if (latestMigration === undefined || migrationName > latestMigration.name) {
      migrationsToRun.push({ name: migrationName, path: fullPath });
    }
  }

  if (migrationsToRun.length === 0) {
    console.log('No migrations to run');
    return;
  }

  migrationsToRun.sort();

  await sql.begin(async (sql) => {
    let i = 0;
    for (const { name, path } of migrationsToRun) {
      ++i;
      console.log(`Running migration ${name} [${i}/${migrationsToRun.length}]`);

      await migrateFile(sql, path, name);
      await sql`INSERT INTO migrations (name, run_at) VALUES (${name}, NOW())`;
    }
  });
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  })
  .then(() => process.exit(0));
