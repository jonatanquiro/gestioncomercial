import { Client } from 'pg';
import { runMigrations } from '../db/migrate';

/** Recrea el esquema de la base de pruebas y aplica todas las migraciones desde cero. */
export default async function setup() {
  const url = process.env.TEST_DATABASE_MIGRATION_URL ?? 'postgres://gc_owner:gc_owner@localhost:5432/gestioncomercial_test';
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('DROP SCHEMA IF EXISTS drizzle CASCADE');
    await client.query('DROP SCHEMA public CASCADE');
    await client.query('CREATE SCHEMA public');
  } finally {
    await client.end();
  }
  await runMigrations(url);
}
