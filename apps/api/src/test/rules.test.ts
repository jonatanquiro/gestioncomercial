import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addEmployee, createTestApp, ownerPool, randomCuit, registerTenant, TEST_PASSWORD, TestClient, uniqueEmail } from './helpers';

let app: NestFastifyApplication;

beforeAll(async () => {
  app = await createTestApp();
});
afterAll(async () => {
  await app.close();
});

async function rolesOf(client: TestClient) {
  return (await client.get('/roles')).body as Array<{ id: string; templateCode: string | null; name: string; isSystem: boolean }>;
}

describe('límites del plan', () => {
  it('el plan Inicial permite 1 sucursal y 3 usuarios', async () => {
    const owner = await registerTenant(app);
    const branch = await owner.client.post('/branches', { name: 'Sucursal 2' });
    expect(branch.status).toBe(402);
    expect(branch.body).toMatchObject({ code: 'PLAN_LIMIT_REACHED', details: { limit: 'max_branches', value: 1 } });

    const cashier = (await rolesOf(owner.client)).find((r) => r.templateCode === 'cashier')!;
    await addEmployee(app, owner.client, cashier.id, owner.me.branchIds);
    await addEmployee(app, owner.client, cashier.id, owner.me.branchIds);
    const fourth = await owner.client.post('/employees', {
      name: 'Cuarto',
      email: uniqueEmail(),
      password: TEST_PASSWORD,
      roleId: cashier.id,
      branchIds: owner.me.branchIds,
    });
    expect(fourth.status).toBe(402);
    expect(fourth.body.details.limit).toBe('max_users');
  });

  it('altas simultáneas no superan el límite (bloqueo del comercio)', async () => {
    const owner = await registerTenant(app);
    const pool = ownerPool();
    try {
      // Plan de prueba con 3 sucursales asignado directamente.
      const plan = await pool.query<{ id: string }>(
        `INSERT INTO plans (id, code, name, price) VALUES (gen_random_uuid(), 'prueba-3-' || floor(random()*1e9), 'Prueba', 0) RETURNING id`,
      );
      await pool.query(`INSERT INTO plan_limits (plan_id, key, value) VALUES ($1, 'max_branches', 3)`, [plan.rows[0]!.id]);
      await pool.query(`UPDATE subscriptions SET plan_id = $1 WHERE tenant_id = $2`, [plan.rows[0]!.id, owner.tenantId]);
    } finally {
      await pool.end();
    }
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => owner.client.post('/branches', { name: `Paralela ${i}` })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(2);
    expect(results.filter((r) => r.status === 402)).toHaveLength(4);
  });
});

describe('roles y empleados', () => {
  it('el rol Propietario no se puede modificar ni eliminar', async () => {
    const owner = await registerTenant(app);
    const ownerRole = (await rolesOf(owner.client)).find((r) => r.isSystem)!;
    expect((await owner.client.put(`/roles/${ownerRole.id}`, { name: 'Dueño', permissions: [] })).body.code).toBe('SYSTEM_ROLE');
    expect((await owner.client.delete(`/roles/${ownerRole.id}`)).body.code).toBe('SYSTEM_ROLE');
  });

  it('nadie puede otorgar permisos que no tiene ni modificar a alguien con más permisos', async () => {
    const owner = await registerTenant(app);
    const roles = await rolesOf(owner.client);
    const custom = await owner.client.post('/roles', { name: 'Gestor de personal', permissions: ['users.manage', 'roles.manage', 'products.read'] });
    const { client: manager } = await addEmployee(app, owner.client, custom.body.id, owner.me.branchIds);

    const escalate = await manager.post('/roles', { name: 'Escalado', permissions: ['sales.void'] });
    expect(escalate.status).toBe(400);
    expect(escalate.body.code).toBe('CANNOT_GRANT');

    const admin = roles.find((r) => r.templateCode === 'admin')!;
    const assign = await manager.post('/employees', {
      name: 'Admin falso',
      email: uniqueEmail(),
      password: TEST_PASSWORD,
      roleId: admin.id,
      branchIds: owner.me.branchIds,
    });
    expect(assign.body.code).toBe('CANNOT_GRANT');

    const employees = (await manager.get('/employees')).body as Array<{ membershipId: string; roleId: string }>;
    const ownerMembership = employees.find((e) => e.roleId === roles.find((r) => r.isSystem)!.id)!;
    const demote = await manager.put(`/employees/${ownerMembership.membershipId}`, {
      roleId: custom.body.id,
      branchIds: owner.me.branchIds,
      status: 'inactive',
    });
    expect(demote.body.code).toBe('CANNOT_GRANT');
  });

  it('debe quedar un propietario activo y nadie se desactiva a sí mismo', async () => {
    const owner = await registerTenant(app);
    const employees = (await owner.client.get('/employees')).body as Array<{ membershipId: string; roleId: string }>;
    const self = employees[0]!;
    const res = await owner.client.put(`/employees/${self.membershipId}`, { roleId: self.roleId, branchIds: owner.me.branchIds, status: 'inactive' });
    expect(res.body.code).toBe('SELF_DEACTIVATION');

    const ownerRole = (await rolesOf(owner.client)).find((r) => r.isSystem)!;
    const { membershipId } = await addEmployee(app, owner.client, ownerRole.id, owner.me.branchIds);
    // Con dos propietarios, se puede desactivar al segundo; con uno solo, no.
    expect(
      (await owner.client.put(`/employees/${membershipId}`, { roleId: ownerRole.id, branchIds: owner.me.branchIds, status: 'inactive' })).status,
    ).toBe(200);
  });

  it('un rol con empleados no se puede eliminar', async () => {
    const owner = await registerTenant(app);
    const cashier = (await rolesOf(owner.client)).find((r) => r.templateCode === 'cashier')!;
    await addEmployee(app, owner.client, cashier.id, owner.me.branchIds);
    expect((await owner.client.delete(`/roles/${cashier.id}`)).body.code).toBe('ROLE_IN_USE');
    const unused = (await rolesOf(owner.client)).find((r) => r.templateCode === 'accountant')!;
    expect((await owner.client.delete(`/roles/${unused.id}`)).status).toBe(200);
  });

  it('un empleado desactivado pierde el acceso al comercio', async () => {
    const owner = await registerTenant(app);
    const cashier = (await rolesOf(owner.client)).find((r) => r.templateCode === 'cashier')!;
    const emp = await addEmployee(app, owner.client, cashier.id, owner.me.branchIds);
    expect((await emp.client.get('/tenant')).status).toBe(200);
    await owner.client.put(`/employees/${emp.membershipId}`, { roleId: cashier.id, branchIds: owner.me.branchIds, status: 'inactive' });
    const res = await emp.client.get('/tenant');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('NO_ACTIVE_TENANT');
  });

  it('una misma persona puede trabajar en dos comercios y elegir cuál usar', async () => {
    const a = await registerTenant(app, { tradeName: 'Kiosco Uno' });
    const b = await registerTenant(app, { tradeName: 'Kiosco Dos' });
    const cashierB = (await rolesOf(b.client)).find((r) => r.templateCode === 'cashier')!;
    const add = await b.client.post('/employees', {
      name: 'Ignorado',
      email: a.input.email,
      password: 'otra-clave-que-no-se-usa',
      roleId: cashierB.id,
      branchIds: b.me.branchIds,
    });
    expect(add.status).toBe(201);
    expect(add.body.existingUser).toBe(true);

    const me = (await a.client.get('/auth/me')).body;
    expect(me.memberships.map((m: { tenantName: string }) => m.tenantName).sort()).toEqual(['Kiosco Dos', 'Kiosco Uno']);
    expect((await a.client.post('/auth/switch-tenant', { tenantId: b.tenantId })).status).toBe(200);
    const after = (await a.client.get('/auth/me')).body;
    expect(after.tenant.tradeName).toBe('Kiosco Dos');
    expect(after.role.name).toBe('Cajero');
  });
});

describe('configuración y auditoría', () => {
  it('guarda la configuración del comercio y la audita con antes y después', async () => {
    const owner = await registerTenant(app);
    const tenant = (await owner.client.get('/tenant')).body;
    const cuit = randomCuit();
    const res = await owner.client.put('/tenant', {
      tradeName: 'Nombre Nuevo',
      legalName: 'Razón Social SRL',
      cuit: `${cuit.slice(0, 2)}-${cuit.slice(2, 10)}-${cuit.slice(10)}`,
      taxCondition: 'responsable_inscripto',
      address: 'Av. Siempre Viva 742',
      phone: '+54 11 5555-5555',
      email: 'contacto@test.local',
      settings: { allowNegativeStock: !tenant.settings.allowNegativeStock, priceRoundingStep: 50 },
    });
    expect(res.status).toBe(200);
    expect(res.body.cuit).toBe(cuit);
    expect(res.body.settings.priceRoundingStep).toBe(50);

    const audit = (await owner.client.get('/audit?entityType=tenant')).body;
    const entry = audit.items.find((i: { action: string }) => i.action === 'tenant.updated');
    expect(entry.before.tradeName).toBe(tenant.tradeName);
    expect(entry.after.tradeName).toBe('Nombre Nuevo');
    expect(entry.actorName).toBe(owner.input.ownerName);
  });

  it('la auditoría no se puede modificar ni borrar, ni siquiera como dueño de la base', async () => {
    await registerTenant(app);
    const pool = ownerPool();
    try {
      await expect(pool.query(`UPDATE audit_log SET action = 'x'`)).rejects.toThrow(/solo agregado/);
      await expect(pool.query(`DELETE FROM audit_log`)).rejects.toThrow(/solo agregado/);
    } finally {
      await pool.end();
    }
  });

  it('no permite desactivar la última sucursal', async () => {
    const owner = await registerTenant(app);
    const res = await owner.client.put(`/branches/${owner.me.branchIds[0]}`, { name: 'Casa central', address: null, status: 'inactive' });
    expect(res.body.code).toBe('LAST_BRANCH');
  });

  it('devuelve errores con formato único y requestId', async () => {
    const owner = await registerTenant(app);
    const res = await owner.client.post('/branches', { name: '' });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'VALIDATION_ERROR', message: expect.any(String), requestId: expect.any(String) });
    expect(res.headers['x-request-id']).toBe(res.body.requestId);
  });
});
