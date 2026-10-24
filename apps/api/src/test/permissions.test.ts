import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addEmployee, createTestApp, registerTenant, TestClient } from './helpers';
import { fillParams, listRoutes } from './routes';

let app: NestFastifyApplication;
const ZERO_UUID = '00000000-0000-7000-8000-000000000000';

beforeAll(async () => {
  app = await createTestApp();
});
afterAll(async () => {
  await app.close();
});

describe('permisos verificados en el servidor para cada ruta', () => {
  it('toda ruta no pública exige sesión (401 sin cookie)', async () => {
    const anon = new TestClient(app);
    anon.cookies.set('gc_csrf', 'x'.repeat(43)); // para llegar a la verificación de sesión
    const routes = listRoutes(app).filter((r) => !r.isPublic);
    expect(routes.length).toBeGreaterThan(15);
    for (const r of routes) {
      const res = await anon.request(r.method, fillParams(r.path, ZERO_UUID), r.method === 'GET' ? undefined : {});
      expect(res.status, `${r.method} ${r.path}`).toBe(401);
    }
  });

  it('toda ruta con permiso responde 403 a un usuario cuyo rol no tiene permisos', async () => {
    const owner = await registerTenant(app);
    const role = await owner.client.post('/roles', { name: 'Sin permisos', permissions: [] });
    expect(role.status).toBe(201);
    const { client } = await addEmployee(app, owner.client, role.body.id, owner.me.branchIds);

    const routes = listRoutes(app).filter((r) => !r.isPublic && !r.isPlatform && r.permissions?.length);
    expect(routes.length).toBeGreaterThan(8);
    for (const r of routes) {
      const res = await client.request(r.method, fillParams(r.path, ZERO_UUID), r.method === 'GET' ? undefined : {});
      expect(res.status, `${r.method} ${r.path}`).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    }
    // Las rutas sin permiso específico (datos propios, comercio, sucursales) siguen accesibles.
    expect((await client.get('/auth/me')).status).toBe(200);
    expect((await client.get('/tenant')).status).toBe(200);
  });

  it('una sesión de comercio no sirve para el panel de plataforma', async () => {
    const owner = await registerTenant(app);
    expect((await owner.client.get('/platform/tenants')).status).toBe(401);
  });

  it('el cajero opera solo lo que su rol permite', async () => {
    const owner = await registerTenant(app);
    const roles = (await owner.client.get('/roles')).body as Array<{ id: string; templateCode: string }>;
    const cashier = roles.find((r) => r.templateCode === 'cashier')!;
    const { client } = await addEmployee(app, owner.client, cashier.id, owner.me.branchIds);
    expect((await client.get('/employees')).status).toBe(403);
    expect((await client.post('/branches', { name: 'Otra' })).status).toBe(403);
    expect((await client.put('/tenant', {})).status).toBe(403);
    const me = (await client.get('/auth/me')).body;
    expect(me.permissions).toContain('sales.create');
    expect(me.permissions).not.toContain('sales.void');
  });
});
