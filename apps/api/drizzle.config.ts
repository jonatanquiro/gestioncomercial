import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dbCredentials: { url: process.env.DATABASE_MIGRATION_URL ?? 'postgres://gc_owner:gc_owner@localhost:5432/gestioncomercial' },
});
