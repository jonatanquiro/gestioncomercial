import { runMigrations } from '../db/migrate';

const url = process.env.DATABASE_MIGRATION_URL;
if (!url) {
  console.error('Falta DATABASE_MIGRATION_URL (conexión con el rol dueño, por ejemplo gc_owner).');
  process.exit(1);
}

runMigrations(url)
  .then(() => console.log('Migraciones aplicadas y catálogos sincronizados.'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
