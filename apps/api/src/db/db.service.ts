import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { loadEnv } from '../config/env';
import * as schema from './schema';

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export interface TenantScope {
  tenantId: string;
  userId: string;
}

/**
 * Único punto de acceso a la base. Cada operación corre en una transacción que
 * fija el rol de base (SET LOCAL ROLE) y el contexto de RLS. El rol de conexión
 * (gc_app) no tiene permisos propios: sin uno de estos métodos no se lee nada.
 */
@Injectable()
export class DbService implements OnModuleDestroy {
  readonly pool: Pool;
  private readonly db: Db;

  constructor() {
    const env = loadEnv();
    this.pool = new Pool({ connectionString: env.DATABASE_URL, max: 10 });
    this.db = drizzle(this.pool, { schema });
  }

  async onModuleDestroy() {
    await this.pool.end();
  }

  /** Operaciones de un comercio. RLS filtra por tenant_id = scope.tenantId. */
  tenant<T>(scope: TenantScope, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      await enterTenant(tx, scope);
      return fn(tx);
    });
  }

  /** Lecturas del propio usuario sin comercio activo (lista de membresías). */
  user<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE gc_tenant`);
      await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true), set_config('app.tenant_id', '', true)`);
      return fn(tx);
    });
  }

  /** Identidad global: usuarios, sesiones, tokens de recuperación. */
  auth<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      await enterAuth(tx);
      return fn(tx);
    });
  }

  /** Panel de plataforma. No ve tablas comerciales, solo agregados. */
  platform<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE gc_platform`);
      await tx.execute(sql`SELECT set_config('app.tenant_id', '', true), set_config('app.user_id', '', true)`);
      return fn(tx);
    });
  }
}

/** Cambia la transacción en curso al rol de comercio con su contexto. */
export async function enterTenant(tx: Tx, scope: TenantScope) {
  await tx.execute(sql`SET LOCAL ROLE gc_tenant`);
  await tx.execute(
    sql`SELECT set_config('app.tenant_id', ${scope.tenantId}, true), set_config('app.user_id', ${scope.userId}, true)`,
  );
}

/** Cambia la transacción en curso al rol de identidad global. */
export async function enterAuth(tx: Tx) {
  await tx.execute(sql`SET LOCAL ROLE gc_auth`);
  await tx.execute(sql`SELECT set_config('app.tenant_id', '', true), set_config('app.user_id', '', true)`);
}
