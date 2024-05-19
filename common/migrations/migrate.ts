import fs from 'fs';
import postgres from 'postgres';

async function migrateFile(sql: postgres.Sql, path: string, name: string) {
  console.log(`Running migration "${name}"`);
  const { migrate } = await import(path);
  await migrate(sql);
}

async function main() {
  if (!process.env.BLERT_DATABASE_URI) {
    throw new Error('BLERT_DATABASE_URI environment variable is required');
  }

  const sql = postgres(process.env.BLERT_DATABASE_URI);

  const migrationsDir = __dirname;
  const migrationFileRegex = /^\d{14}-([a-zA-Z0-9\-]+)\.js$/;

  let migrationsRun = 0;

  const files = fs.readdirSync(migrationsDir);
  for (const file of files) {
    const match = migrationFileRegex.exec(file);
    if (match === null) {
      continue;
    }

    migrationsRun++;
    const path = `${migrationsDir}/${file}`;
    const migrationName = match[1];

    await migrateFile(sql, path, migrationName);
  }

  console.log(`Ran ${migrationsRun} migrations`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .then(() => process.exit(0));
