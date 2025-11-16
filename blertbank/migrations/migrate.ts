import { runMigrationsCli } from '@blert/common/dist/migrations';

async function main() {
  await runMigrationsCli({
    dbUriEnvVar: 'BLERTBANK_DATABASE_URI',
    migrationsDir: __dirname,
    tableName: 'blertbank_migrations',
  });
}

void main()
  .catch((err: Error) => {
    console.error(err.message);
    process.exit(1);
  })
  .then(() => process.exit(0));
