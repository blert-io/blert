import { runMigrationsCli } from './runner';

async function main() {
  await runMigrationsCli({
    dbUriEnvVar: 'BLERT_DATABASE_URI',
    migrationsDir: __dirname,
  });
}

void main()
  .catch((err: Error) => {
    console.error(err.message);
    process.exit(1);
  })
  .then(() => process.exit(0));
