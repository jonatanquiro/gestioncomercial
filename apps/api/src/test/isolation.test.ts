import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DbService } from '../db/db.service';
import { branches, rolePermissions, roles } from '../db/schema';
import { addEmployee, createTestApp, ownerPool, registerTenant } from './helpers';
import { fillParams, listRoutes } from './routes';

let app: NestFastifyApplication;
let a: Awaited<ReturnType<typeof registerTenant>>;
let b: Awaited<ReturnType<typeof registerTenant>>;
let bIds: { branch: string; role: string; membership: string };

beforeAll(async () => {
  app = await createTestApp();
  a = await registerTenant(app, { tradeName: 'Comercio A' });
  b = await registerTenant(app, { tradeName: 'Comercio B' });
  const bRoles = (await b.client.get('/roles')).body as Array<{ id: string; templateCode: string }>;
  const cashier = bRoles.find((r) => r.templateCode === 'cashier')!;
  const emp = await addEmployee(app, b.client, cashier.id, b.me.branchIds);
  bIds = { branch: b.me.branchIds[0]!, role: cashier.id, membership: emp.membershipId };
});
afterAll(async () => {
  await app.close();
});

describe('aislamiento entre comercios por API', () => {
  it('A no ve datos de B en los listados', async () => {
    const branchesA = (await a.client.get('/branches')).body as Array<{ id: string }>;
    expect(branchesA.map((x) => x.id)).not.toContain(bIds.branch);
    const rolesA = (await a.client.get('/roles')).body as Array<{ id: string }>;
    expect(rolesA.map((x) => x.id)).not.toContain(bIds.role);
    const empA = (await a.client.get('/employees')).body as Array<{ membershipId: string }>;
    expect(empA.map((x) => x.membershipId)).not.toContain(bIds.membership);
    const auditA = (await a.client.get('/audit?pageSize=100')).body as { items: Array<{ entityId: string }> };
    expect(auditA.items.map((x) => x.entityId)).not.toContain(b.tenantId);
  });

  it('cada ruta con identificador responde 404 ante un ID de otro comercio', async () => {
    const routes = listRoutes(app).filter((r) => !r.isPublic && !r.isPlatform && r.path.includes(':'));
    expect(routes.length).toBeGreaterThan(0);
    const idFor = (path: string) =>
      path.startsWith('/branches') ? bIds.branch : path.startsWith('/roles') ? bIds.role : path.startsWith('/employees') ? bIds.membership : null;
    const bodies: Record<string, unknown> = {
      '/branches/:id': { name: 'Hackeada', address: null, status: 'active' },
      '/roles/:id': { name: 'Hackeado', permissions: [] },
      '/employees/:membershipId': { roleId: bIds.role, branchIds: [bIds.branch], status: 'inactive' },
    };
    const checked: string[] = [];
    for (const r of routes) {
      const id = idFor(r.path);
      if (!id) continue; // p. ej. /auth/sessions/:id, cubierta abajo
      const res = await a.client.request(r.method, fillParams(r.path, id), r.method === 'GET' || r.method === 'DELETE' ? undefined : bodies[r.path]);
      expect(res.status, `${r.method} ${r.path}`).toBe(404);
      checked.push(`${r.method} ${r.path}`);
    }
    expect(checked).toEqual(expect.arrayContaining(['PUT /branches/:id', 'PUT /roles/:id', 'DELETE /roles/:id', 'PUT /employees/:membershipId']));

    // Y B sigue intacto.
    const branchesB = (await b.client.get('/branches')).body as Array<{ id: string; name: string }>;
    expect(branchesB.find((x) => x.id === bIds.branch)?.name).toBe('Casa central');
  });

  it('no permite referenciar recursos de otro comercio dentro de un cuerpo', async () => {
    const aRoles = (await a.client.get('/roles')).body as Array<{ id: string; templateCode: string }>;
    const res = await a.client.post('/employees', {
      name: 'Cruzado',
      email: 'cruzado@test.local',
      password: 'clave-segura-cruzada-1',
      roleId: aRoles.find((r) => r.templateCode === 'cashier')!.id,
      branchIds: [bIds.branch],
    });
    expect(res.status).toBe(404);
    const res2 = await a.client.post('/employees', {
      name: 'Cruzado',
      email: 'cruzado2@test.local',
      password: 'clave-segura-cruzada-1',
      roleId: bIds.role,
      branchIds: a.me.branchIds,
    });
    expect(res2.status).toBe(404);
  });

  it('no permite cerrar sesiones de otro usuario', async () => {
    const sessionsB = (await b.client.get('/auth/sessions')).body as Array<{ id: string }>;
    const res = await a.client.delete(`/auth/sessions/${sessionsB[0]!.id}`);
    expect(res.status).toBe(404);
    expect((await b.client.get('/auth/me')).status).toBe(200);
  });

  it('no permite seleccionar un comercio del que no es miembro', async () => {
    const res = await a.client.post('/auth/switch-tenant', { tenantId: b.tenantId });
    expect(res.status).toBe(404);
  });
});

describe('aislamiento en la base (RLS y claves compuestas)', () => {
  it('con el contexto de A, la base no devuelve filas de B aunque se omita el filtro', async () => {
    const db = app.get(DbService);
    const rows = await db.tenant({ tenantId: a.tenantId, userId: a.me.user.id }, (tx) => tx.select().from(branches));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.tenantId === a.tenantId)).toBe(true);
  });

  it('rechaza insertar filas con el tenant_id de otro comercio', async () => {
    const db = app.get(DbService);
    await expect(
      db.tenant({ tenantId: a.tenantId, userId: a.me.user.id }, (tx) =>
        tx.insert(roles).values({ id: crypto.randomUUID(), tenantId: b.tenantId, name: 'Infiltrado' }),
      ),
    ).rejects.toThrow();
  });

  it('la FK compuesta impide vincular un permiso a un rol de otro comercio', async () => {
    const db = app.get(DbService);
    await expect(
      db.tenant({ tenantId: a.tenantId, userId: a.me.user.id }, (tx) =>
        tx.insert(rolePermissions).values({ tenantId: a.tenantId, roleId: bIds.role, permissionCode: 'sales.void' }),
      ),
    ).rejects.toThrow();
  });

  it('sin contexto de comercio no se ve ninguna fila', async () => {
    const db = app.get(DbService);
    const rows = await db.user(a.me.user.id, (tx) => tx.execute(sql`SELECT count(*)::int AS n FROM branches`));
    expect(rows.rows[0]).toEqual({ n: 0 });
  });

  it('el rol de conexión de la API no puede leer tablas sin elegir un rol', async () => {
    const db = app.get(DbService);
    await expect(db.pool.query('SELECT * FROM tenants LIMIT 1')).rejects.toThrow(/permission denied|does not exist/);
  });

  it('el panel de plataforma no puede leer tablas comerciales', async () => {
    const db = app.get(DbService);
    await expect(db.platform((tx) => tx.select().from(branches))).rejects.toThrow();
  });

  it('toda tabla con tenant_id tiene RLS o es inaccesible para el rol de comercio', async () => {
    const pool = ownerPool();
    try {
      // sessions guarda el comercio activo de la sesión, pero solo la toca gc_auth.
      const { rows } = await pool.query<{ table_name: string; rls: boolean }>(`
        SELECT c.relname AS table_name,
               c.relrowsecurity OR NOT has_table_privilege('gc_tenant', c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS rls
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN information_schema.columns col ON col.table_schema = n.nspname AND col.table_name = c.relname
        WHERE n.nspname = 'public' AND c.relkind = 'r' AND col.column_name = 'tenant_id'`);
      expect(rows.length).toBeGreaterThan(5);
      const missing = rows.filter((r) => !r.rls).map((r) => r.table_name);
      expect(missing).toEqual([]);
    } finally {
      await pool.end();
    }
  });
});
