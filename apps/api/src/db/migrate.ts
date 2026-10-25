import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { syncCatalogs } from './catalog-sync';

export const MIGRATIONS_DIR = resolve(__dirname, 'migrations');

/** Aplica migraciones pendientes y sincroniza catálogos. Usa el rol dueño. */
export async function runMigrations(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_DIR });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await syncCatalogs(client);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}
