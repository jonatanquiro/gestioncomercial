import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { MeResponse } from '@gc/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, randomCuit, registerTenant, sentMail, TEST_PASSWORD, TestClient } from './helpers';

let app: NestFastifyApplication;

beforeAll(async () => {
  app = await createTestApp();
});
afterAll(async () => {
  await app.close();
});

describe('registro de comercio', () => {
  it('crea comercio, propietario, sucursal, roles plantilla y deja la sesión iniciada', async () => {
    const { client, me, input } = await registerTenant(app, { businessTypeCode: 'ferreteria' });
    expect(me.user.email).toBe(input.email);
    expect(me.tenant?.tradeName).toBe(input.tradeName);
    expect(me.tenant?.status).toBe('trial');
    expect(me.role?.name).toBe('Propietario');
    expect(me.permissions).toContain('subscription.manage');
    expect(me.branchIds).toHaveLength(1);

    const tenant = await client.get('/tenant');
    expect(tenant.body.businessTypeCode).toBe('ferreteria');
    expect(tenant.body.settings.allowNegativeStock).toBe(false);
    expect(tenant.body.plan.code).toBe('inicial');

    const roles = await client.get('/roles');
    expect(roles.body.map((r: { name: string }) => r.name)).toEqual(
      expect.arrayContaining(['Propietario', 'Administrador', 'Encargado', 'Cajero', 'Repositor', 'Vendedor', 'Responsable de compras', 'Contador']),
    );
  });

  it('rechaza email repetido, CUIT inválido, contraseña común y rubro inexistente', async () => {
    const { input } = await registerTenant(app);
    const c = new TestClient(app);
    const dup = await c.post('/auth/register', { ...input, tradeName: 'Otro' });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('EMAIL_IN_USE');

    const badCuit = await c.post('/auth/register', { ...input, email: 'x1@test.local', cuit: '20-12345678-0' });
    expect(badCuit.status).toBe(400);
    expect(badCuit.body.details[0].path).toBe('cuit');

    const weak = await c.post('/auth/register', { ...input, email: 'x2@test.local', password: '1234567890' });
    expect(weak.status).toBe(400);

    const badType = await c.post('/auth/register', { ...input, email: 'x3@test.local', businessTypeCode: 'nave-espacial' });
    expect(badType.status).toBe(400);
  });

  it('no permite dos comercios activos con el mismo CUIT', async () => {
    const cuit = randomCuit();
    await registerTenant(app, { cuit: `${cuit.slice(0, 2)}-${cuit.slice(2, 10)}-${cuit.slice(10)}` });
    const c = new TestClient(app);
    const res = await c.post('/auth/register', {
      tradeName: 'Copia',
      cuit,
      taxCondition: 'responsable_inscripto',
      businessTypeCode: 'kiosco',
      ownerName: 'Otra persona',
      email: 'copia@test.local',
      password: TEST_PASSWORD,
    });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/CUIT/);
  });
});

describe('login, sesiones y CSRF', () => {
  it('inicia y cierra sesión; la sesión cerrada ya no sirve', async () => {
    const { input } = await registerTenant(app);
    const c = new TestClient(app);
    expect((await c.get('/auth/me')).status).toBe(401);
    const login = await c.post('/auth/login', { email: input.email.toUpperCase(), password: TEST_PASSWORD });
    expect(login.status).toBe(200);
    expect((await c.get<MeResponse>('/auth/me')).body.user.email).toBe(input.email);

    const stolen = new Map(c.cookies);
    expect((await c.post('/auth/logout')).status).toBe(200);
    const replay = new TestClient(app);
    replay.cookies = stolen;
    expect((await replay.get('/auth/me')).status).toBe(401);
  });

  it('responde igual para email inexistente y contraseña incorrecta', async () => {
    const { input } = await registerTenant(app);
    const c = new TestClient(app);
    const wrong = await c.post('/auth/login', { email: input.email, password: 'otra-clave-incorrecta' });
    const missing = await c.post('/auth/login', { email: 'nadie@test.local', password: 'otra-clave-incorrecta' });
    expect(wrong.status).toBe(401);
    expect(missing.status).toBe(401);
    expect(wrong.body.code).toBe(missing.body.code);
    expect(wrong.body.message).toBe(missing.body.message);
  });

  it('bloquea tras demasiados intentos fallidos', async () => {
    const { input } = await registerTenant(app);
    const c = new TestClient(app);
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await c.post('/auth/login', { email: input.email, password: 'incorrecta-123' })).status);
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it('exige el token CSRF en mutaciones', async () => {
    const { client } = await registerTenant(app);
    const res = await client.post('/branches', { name: 'Sin token' }, { csrf: false });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('CSRF_INVALID');
  });

  it('lista sesiones y permite cerrar otra sesión', async () => {
    const { client, input } = await registerTenant(app);
    const other = new TestClient(app);
    await other.post('/auth/login', { email: input.email, password: TEST_PASSWORD });
    const list = await client.get('/auth/sessions');
    expect(list.body).toHaveLength(2);
    const otherSession = list.body.find((s: { current: boolean }) => !s.current);
    expect((await client.delete(`/auth/sessions/${otherSession.id}`)).status).toBe(200);
    expect((await other.get('/auth/me')).status).toBe(401);
    expect((await client.get('/auth/me')).status).toBe(200);
  });
});

describe('contraseñas', () => {
  it('recupera la contraseña con un enlace de un solo uso y cierra las sesiones abiertas', async () => {
    const { client, input } = await registerTenant(app);
    const anon = new TestClient(app);
    const res = await anon.post('/auth/forgot-password', { email: input.email });
    expect(res.status).toBe(202);
    const mail = sentMail(app).find((m) => m.to === input.email);
    expect(mail).toBeDefined();
    const token = decodeURIComponent(/token=([^\s]+)/.exec(mail!.text)![1]!);

    const newPassword = 'nueva-clave-segura-2';
    expect((await anon.post('/auth/reset-password', { token, password: newPassword })).status).toBe(200);
    const reuse = await anon.post('/auth/reset-password', { token, password: 'otra-clave-segura-3' });
    expect(reuse.status).toBe(400);
    expect(reuse.body.code).toBe('RESET_TOKEN_INVALID');

    expect((await client.get('/auth/me')).status).toBe(401);
    expect((await anon.post('/auth/login', { email: input.email, password: TEST_PASSWORD })).status).toBe(401);
    expect((await anon.post('/auth/login', { email: input.email, password: newPassword })).status).toBe(200);
  });

  it('responde igual si el email no existe y no envía correo', async () => {
    const before = sentMail(app).length;
    const res = await new TestClient(app).post('/auth/forgot-password', { email: 'inexistente@test.local' });
    expect(res.status).toBe(202);
    expect(sentMail(app).length).toBe(before);
  });

  it('cambia la contraseña verificando la actual y cierra las otras sesiones', async () => {
    const { client, input } = await registerTenant(app);
    const other = new TestClient(app);
    await other.post('/auth/login', { email: input.email, password: TEST_PASSWORD });
    const bad = await client.post('/auth/change-password', { currentPassword: 'no-es-esta-1', newPassword: 'nueva-clave-segura-9' });
    expect(bad.status).toBe(400);
    const ok = await client.post('/auth/change-password', { currentPassword: TEST_PASSWORD, newPassword: 'nueva-clave-segura-9' });
    expect(ok.status).toBe(200);
    expect((await client.get('/auth/me')).status).toBe(200);
    expect((await other.get('/auth/me')).status).toBe(401);
  });
});
